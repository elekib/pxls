use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use std::net::SocketAddr;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use std::thread;
use std::time::Instant;
use tracing::info;

mod actions;
mod auth;
mod config;
mod database;
mod font;
mod image_guard;
mod modes;
mod net_guard;
mod notification;
mod pages;
mod pixoo_wrapper;
mod renderer;
mod rendering;
mod routes;
mod token_manager;
mod webhook_enhanced;
mod webhook_image_processor;

use actions::ActionExecutor;
use config::Config;
use database::WebhookDatabase;
use notification::NotificationManager;
use pixoo_wrapper::PixooWrapper;
use rendering::loop_renderer::rendering_loop;
use token_manager::TokenManager;
use webhook_image_processor::WebhookImageProcessor;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Mutex<Config>>,
    pub pixoo: Arc<Mutex<PixooWrapper>>,
    pub should_reconnect: Arc<AtomicBool>,
    pub manual_disconnect: Arc<AtomicBool>,
    pub tool_active_until: Arc<Mutex<Instant>>,
    pub active_tool_type: Arc<Mutex<Option<String>>>,
    pub notification_manager: NotificationManager,
    pub webhook_image_processor: Arc<tokio::sync::Mutex<WebhookImageProcessor>>,
    pub webhook_database: Arc<WebhookDatabase>,
    pub action_executor: Arc<ActionExecutor>,
    pub token_manager: Arc<TokenManager>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing subscriber with env filter for log level control
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(true)
        .with_level(true)
        .init();

    info!("Starting pxls backend");

    // Fail closed: never serve an unauthenticated API.
    let auth_config = match auth::AuthConfig::from_env() {
        Ok(auth) => auth,
        Err(e) => {
            tracing::error!(
                "Refusing to start: {}. Set {} to a random value of at least {} characters.",
                e,
                auth::TOKEN_ENV,
                auth::MIN_TOKEN_LEN
            );
            std::process::exit(1);
        }
    };

    let config = Config::load().unwrap_or_default();
    let config = Arc::new(Mutex::new(config));

    let pixoo = PixooWrapper::new();
    let pixoo = Arc::new(Mutex::new(pixoo));

    let should_reconnect = Arc::new(AtomicBool::new(false));
    let manual_disconnect = Arc::new(AtomicBool::new(false));
    let tool_active_until = Arc::new(Mutex::new(Instant::now()));
    let active_tool_type = Arc::new(Mutex::new(None));
    let notification_manager = NotificationManager::new();
    let webhook_image_processor = Arc::new(tokio::sync::Mutex::new(WebhookImageProcessor::new()));
    let webhook_database = Arc::new(WebhookDatabase::new("/app/data"));
    match webhook_database.ensure_secrets() {
        Ok(0) => {}
        Ok(n) => info!(
            "Generated a secret for {} webhook(s); view it on the Webhooks page",
            n
        ),
        Err(e) => tracing::warn!("Could not ensure webhook secrets: {}", e),
    }
    let action_executor = Arc::new(ActionExecutor::new(
        notification_manager.clone(),
        webhook_image_processor.clone(),
        pixoo.clone(),
    ));
    let token_manager = Arc::new(TokenManager::new(config.clone()));

    let state = AppState {
        config: config.clone(),
        pixoo: pixoo.clone(),
        should_reconnect: should_reconnect.clone(),
        manual_disconnect: manual_disconnect.clone(),
        tool_active_until: tool_active_until.clone(),
        active_tool_type: active_tool_type.clone(),
        notification_manager: notification_manager.clone(),
        webhook_image_processor: webhook_image_processor.clone(),
        webhook_database: webhook_database.clone(),
        action_executor: action_executor.clone(),
        token_manager: token_manager.clone(),
    };

    // --- Start Rendering Loop in Background Thread ---
    let render_pixoo = Arc::clone(&pixoo);
    let render_config = Arc::clone(&config);
    let render_reconnect = Arc::clone(&should_reconnect);
    let render_manual_disconnect = Arc::clone(&manual_disconnect);
    let render_tool_active = Arc::clone(&tool_active_until);
    let render_notification_manager = notification_manager.clone();
    let render_token_manager = Arc::clone(&token_manager);
    thread::spawn(move || {
        rendering_loop(
            render_pixoo,
            render_config,
            render_reconnect,
            render_manual_disconnect,
            render_tool_active,
            render_notification_manager,
            render_token_manager,
        );
    });

    let cors = auth::cors_from_env();

    let app = Router::new()
        .route(
            "/api/config",
            get(routes::config::get_config).post(routes::config::update_config),
        )
        .route("/api/beszel/status", get(routes::beszel::auth_status))
        .route("/api/beszel/test-login", post(routes::beszel::test_login))
        .route("/api/connect", post(routes::device::connect_device))
        .route("/api/disconnect", post(routes::device::disconnect_device))
        .route(
            "/api/connection-status",
            get(routes::device::connection_status),
        )
        .route(
            "/api/device-config",
            post(routes::device::update_device_config),
        )
        .route(
            "/api/upload",
            post(routes::upload::upload_file).layer(DefaultBodyLimit::max(
                image_guard::MAX_UPLOAD_BYTES + 64 * 1024,
            )),
        )
        .route("/api/uploads/:filename", get(routes::upload::serve_file))
        .route("/api/health", get(routes::health::health_check))
        .route("/api/buzzer", post(routes::tools::play_buzzer))
        .route("/api/countdown", post(routes::tools::start_countdown))
        .route(
            "/api/sound-detector",
            post(routes::tools::start_sound_detector),
        )
        .route("/api/scoreboard", post(routes::tools::set_scoreboard))
        .route("/api/stop-tool", post(routes::tools::stop_tool))
        .route("/api/webhook/:name", post(routes::webhooks::handle_webhook))
        .route(
            "/api/webhook-events",
            get(routes::webhook_events::get_webhook_events),
        )
        .route(
            "/api/webhook-events/clear/:webhook_name",
            post(routes::webhook_events::clear_webhook_events),
        )
        .route(
            "/api/webhook-events/clear-all",
            post(routes::webhook_events::clear_all_webhook_events),
        )
        .route(
            "/api/webhook-events/summary",
            get(routes::webhook_events::get_webhook_events_summary),
        )
        .route(
            "/api/webhook-events/:event_id/replay",
            post(routes::webhook_events::replay_webhook_event),
        )
        .route(
            "/api/enhanced-webhooks",
            get(routes::enhanced_webhooks::get_enhanced_webhooks),
        )
        .route(
            "/api/enhanced-webhooks",
            post(routes::enhanced_webhooks::create_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            get(routes::enhanced_webhooks::get_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            put(routes::enhanced_webhooks::update_enhanced_webhook),
        )
        .route(
            "/api/enhanced-webhooks/:name",
            delete(routes::enhanced_webhooks::delete_enhanced_webhook),
        )
        .route(
            "/api/webhooks/:name/rules",
            get(routes::webhook_rules::get_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules",
            post(routes::webhook_rules::create_webhook_rule),
        )
        .route(
            "/api/webhooks/:name/rules/test",
            post(routes::webhook_rules::test_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules-order",
            put(routes::webhook_rules::reorder_webhook_rules),
        )
        .route(
            "/api/webhooks/:name/rules/:rule_id",
            put(routes::webhook_rules::update_webhook_rule),
        )
        .route(
            "/api/webhooks/:name/rules/:rule_id",
            delete(routes::webhook_rules::delete_webhook_rule),
        )
        .layer(middleware::from_fn_with_state(
            auth_config,
            auth::require_token,
        ))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3400));
    info!("Backend API server running on http://{}", addr);
    info!("Display engine running in background...");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
