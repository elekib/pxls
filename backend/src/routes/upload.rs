use axum::{
    body::Body,
    extract::Multipart,
    extract::Path as AxumPath,
    http::{header, StatusCode},
    response::Response,
};
use serde_json::{json, Value};
use std::path::Path;
use tracing::{instrument, warn};

use crate::image_guard::{
    content_type_for, resolve_upload_path, sanitize_stem, validate_image_bytes, MAX_UPLOAD_BYTES,
};

pub const UPLOADS_DIR: &str = "/app/data/uploads";

fn json_response(status: StatusCode, body: Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into())
        .unwrap()
}

fn error_response(status: StatusCode, message: &str) -> Response {
    json_response(status, json!({ "error": message }))
}

#[instrument(skip(multipart))]
pub async fn upload_file(mut multipart: Multipart) -> Response {
    if let Err(e) = tokio::fs::create_dir_all(UPLOADS_DIR).await {
        warn!("Failed to create uploads directory: {}", e);
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create uploads directory",
        );
    }

    if let Ok(Some(field)) = multipart.next_field().await {
        let original_name = field.file_name().unwrap_or("upload").to_string();

        let data = match field.bytes().await {
            Ok(data) => data,
            Err(_) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "Failed to read file (too large or malformed)",
                )
            }
        };
        if data.len() > MAX_UPLOAD_BYTES {
            return error_response(StatusCode::BAD_REQUEST, "File too large (max 5MB)");
        }

        // Trust the content, not the client-supplied name or extension.
        let ext = match validate_image_bytes(&data) {
            Ok(ext) => ext,
            Err(msg) => return error_response(StatusCode::BAD_REQUEST, &msg),
        };

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let unique = &uuid::Uuid::new_v4().simple().to_string()[..8];
        let stored_name = format!(
            "{}_{}_{}.{}",
            timestamp,
            unique,
            sanitize_stem(&original_name),
            ext
        );
        let filepath = Path::new(UPLOADS_DIR).join(&stored_name);

        return match tokio::fs::write(&filepath, &data).await {
            Ok(_) => json_response(
                StatusCode::OK,
                json!({
                    "success": true,
                    "filename": stored_name,
                    "original_name": original_name,
                    "size": data.len()
                }),
            ),
            Err(e) => {
                warn!("Failed to save upload: {}", e);
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file")
            }
        };
    }

    error_response(StatusCode::BAD_REQUEST, "No file uploaded")
}

#[instrument]
pub async fn serve_file(AxumPath(filename): AxumPath<String>) -> Response {
    let not_found = || error_response(StatusCode::NOT_FOUND, "File not found");

    let content_type = match content_type_for(&filename) {
        Some(ct) => ct,
        None => return not_found(),
    };
    let path = match resolve_upload_path(Path::new(UPLOADS_DIR), &filename) {
        Some(p) => p,
        None => return not_found(),
    };
    match tokio::fs::read(&path).await {
        Ok(data) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CACHE_CONTROL, "private, max-age=3600")
            .body(Body::from(data))
            .unwrap(),
        Err(_) => not_found(),
    }
}
