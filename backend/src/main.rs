use std::net::SocketAddr;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use std::thread;
use std::time::Instant;
use tracing::info;

mod accounts;
mod actions;
mod auth;
mod config;
mod database;
mod device;
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

    // Fail closed: the API only works with a user account behind it.
    let auth_state = match database::accounts::AccountsDb::open(std::path::Path::new("/app/data"))
        .map_err(|e| e.to_string())
        .and_then(|db| {
            accounts::AuthState::init(db, &std::env::var(auth::ORIGINS_ENV).unwrap_or_default())
        }) {
        Ok(a) => a,
        Err(e) => {
            tracing::error!("Refusing to start: could not set up authentication: {}", e);
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

    let app = routes::build_app(state, auth_state, auth::cors_from_env());

    let addr = SocketAddr::from(([0, 0, 0, 0], 3400));
    info!("Backend API server running on http://{}", addr);
    info!("Display engine running in background...");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
// cache test
