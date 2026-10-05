use axum::{
    extract::Path as AxumPath,
    extract::Multipart,
    response::Response,
    http::{StatusCode, header},
    body::Body,
};
use serde_json::json;
use tracing::instrument;

#[instrument]
pub async fn upload_file(mut multipart: Multipart) -> Response {
    let uploads_dir = "/app/data/uploads";
    if !std::path::Path::new(uploads_dir).exists() {
        if let Err(e) = tokio::fs::create_dir_all(uploads_dir).await {
            let error = json!({"error": format!("Failed to create uploads directory: {}", e)});
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap();
        }
    }

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("unknown").to_string();
        let filename = field.file_name().unwrap_or("upload").to_string();
        
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let safe_filename = format!("{}_{}", timestamp, filename.replace(' ', "_"));
        let filepath = format!("{}/{}", uploads_dir, safe_filename);
        
        match field.bytes().await {
            Ok(data) => {
                // Validate file size (max 5MB)
                if data.len() > 5 * 1024 * 1024 {
                    let error = json!({"error": "File too large (max 5MB)"});
                    return Response::builder()
                        .status(StatusCode::BAD_REQUEST)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap();
                }
                
                // Validate file type
                let is_valid = filename.ends_with(".png") 
                    || filename.ends_with(".jpg") 
                    || filename.ends_with(".jpeg")
                    || filename.ends_with(".gif")
                    || filename.ends_with(".bmp")
                    || filename.ends_with(".webp");
                
                if !is_valid {
                    let error = json!({"error": "Invalid file type. Allowed: PNG, JPG, JPEG, GIF, BMP, WEBP"});
                    return Response::builder()
                        .status(StatusCode::BAD_REQUEST)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(error.to_string().into())
                        .unwrap();
                }
                
                // Write file
                match tokio::fs::write(&filepath, &data).await {
                    Ok(_) => {
                        let success = json!({
                            "success": true,
                            "filename": safe_filename,
                            "original_name": filename,
                            "size": data.len()
                        });
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(success.to_string().into())
                            .unwrap();
                    }
                    Err(e) => {
                        let error = json!({"error": format!("Failed to save file: {}", e)});
                        return Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(error.to_string().into())
                            .unwrap();
                    }
                }
            }
            Err(e) => {
                let error = json!({"error": format!("Failed to read file: {}", e)});
                return Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(error.to_string().into())
                    .unwrap();
            }
        }
    }
    
    let error = json!({"error": "No file uploaded"});
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header(header::CONTENT_TYPE, "application/json")
        .body(error.to_string().into())
        .unwrap()
}

#[instrument]
pub async fn serve_file(AxumPath(filename): AxumPath<String>) -> Response {
    let filepath = format!("/app/data/uploads/{}", filename);
    
    match tokio::fs::read(&filepath).await {
        Ok(data) => {
            let content_type = if filename.ends_with(".png") {
                "image/png"
            } else if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                "image/jpeg"
            } else if filename.ends_with(".gif") {
                "image/gif"
            } else if filename.ends_with(".bmp") {
                "image/bmp"
            } else if filename.ends_with(".webp") {
                "image/webp"
            } else {
                "application/octet-stream"
            };
            
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from(data))
                .unwrap()
        }
        Err(_) => {
            let error = json!({"error": "File not found"});
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "application/json")
                .body(error.to_string().into())
                .unwrap()
        }
    }
}
