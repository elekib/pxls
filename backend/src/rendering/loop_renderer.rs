use crate::device::Pixoo;
use bluetooth_serial_port::BtAddr;
use std::str::FromStr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::System;
use tracing::{debug, error, info, warn};

use super::device_config::apply_device_config;
use super::notification_page::render_notification_page;
use crate::config::Config;
use crate::modes::divoom::{apply_divoom_mode, apply_divoom_mode_from_config, is_divoom_page_type};
use crate::notification::NotificationManager;
use crate::pages::PageRenderer;
use crate::pixoo_wrapper::{self, PixooWrapper, ToolLink};
use crate::token_manager::TokenManager;
use crate::tool_state::ToolTimer;

pub fn rendering_loop(
    pixoo: Arc<Mutex<PixooWrapper>>,
    config: Arc<Mutex<Config>>,
    should_reconnect: Arc<AtomicBool>,
    manual_disconnect: Arc<AtomicBool>,
    tool: Arc<Mutex<ToolTimer>>,
    notification_manager: NotificationManager,
    token_manager: Arc<TokenManager>,
) {
    let mut sys = System::new_all();
    let mut last_mac = String::new();
    let mut current_page_index: usize = 0;
    let mut last_page_switch = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut consecutive_failures = 0;
    // Track the last applied native mode so we only re-send it when it changes
    // or periodically as a keep-alive. Previously these were `static mut`, which
    // is undefined behavior; they are loop-local state and belong here.
    let mut last_native_mode = String::new();
    let mut last_native_mode_applied: Option<Instant> = None;
    // Track the last divoom page applied during custom rotation so we don't
    // spam set_mode every refresh tick (the device renders native modes itself).
    let mut last_divoom_page_index: Option<usize> = None;
    let mut last_divoom_page_apply: Option<Instant> = None;
    // Whether a tool was running on the previous tick, to notice when it ends.
    let mut prev_tool_active = false;

    loop {
        sys.refresh_all();

        let is_manual_disconnect = manual_disconnect.load(Ordering::SeqCst);

        if should_reconnect.load(Ordering::SeqCst) {
            if is_manual_disconnect {
                info!("Reconnect signal received but manual disconnect is active, skipping");
                should_reconnect.store(false, Ordering::SeqCst);
            } else {
                info!("Reconnect signal received, reconnecting to device");
                try_reconnect(&pixoo, &config, &tool);
                should_reconnect.store(false, Ordering::SeqCst);
            }
        }

        // Check if MAC changed in config
        let current_mac = {
            let cfg = config.lock().unwrap();
            cfg.pixoo_mac.clone()
        };

        if !last_mac.is_empty() && last_mac != current_mac && !is_manual_disconnect {
            info!(old_mac = %last_mac, new_mac = %current_mac, "MAC address changed, reconnecting");
            should_reconnect.store(true, Ordering::SeqCst);
        }
        last_mac = current_mac;

        let rotation_time = {
            let cfg = config.lock().unwrap();
            cfg.rotation_time_secs
        };

        let has_connection = {
            let wrapper = pixoo.lock().unwrap();
            wrapper.get().is_some()
        };

        let (expired_tool, tool_active) = {
            let mut t = tool.lock().unwrap();
            (t.poll_expired(), t.is_active())
        };
        if prev_tool_active && !tool_active {
            // A tool ended (timer ran out or Stop): forget when native modes
            // were last applied so the display returns on this tick, not after
            // the next ~10 s keep-alive.
            last_native_mode_applied = None;
            last_divoom_page_index = None;
            last_divoom_page_apply = None;
        }
        prev_tool_active = tool_active;
        if let (Some(kind), true) = (expired_tool, has_connection) {
            // Same link, no reconnect: switch the display back right away.
            let device_config = config.lock().unwrap().device_config.clone();
            if let Ok(mut wrapper) = pixoo.lock() {
                match wrapper.with_link(|p| pixoo_wrapper::end_tool(p, kind, false, &device_config))
                {
                    Ok(()) => info!(tool = kind.as_str(), "Tool finished, display restored"),
                    Err(e) => warn!(error = %e, "Failed to restore display after tool"),
                }
            }
        }

        if !has_connection {
            if is_manual_disconnect {
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            if tool_active {
                thread::sleep(Duration::from_secs(1));
                continue;
            }

            warn!("No connection detected, attempting to reconnect");
            try_reconnect(&pixoo, &config, &tool);
            thread::sleep(Duration::from_secs(5));
            continue;
        }

        // A tool is running (scoreboard, countdown, etc.): skip all rendering to
        // avoid overriding the tool display.
        if tool_active {
            // Tool is active - just update heartbeat timer and sleep
            // Don't send any commands that might override the tool display
            last_heartbeat = Instant::now();
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        // Check for active notification
        notification_manager.clear_if_expired();
        if let Some(notification) = notification_manager.get_active() {
            // Render notification page
            let img = render_notification_page(&notification);
            if let Err(e) = PageRenderer::push_image(&pixoo, img) {
                error!(error = %e, "Failed to push notification image");
            }
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        // Get current device mode and enabled pages
        let (device_mode, enabled_pages) = {
            let cfg = config.lock().unwrap();
            (
                cfg.device_config.light_mode.clone(),
                cfg.custom_pages
                    .iter()
                    .filter(|p| p.enabled)
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        };

        let _is_custom_mode = device_mode == "custom" && !enabled_pages.is_empty();

        // Heartbeat / keep-alive is handled per-branch below. We intentionally do
        // NOT send a set_color heartbeat in native Divoom mode: that overwrites
        // the device's native display (e.g. blanking the environment clock), which
        // was causing the "clock -> blank -> clock" flicker. The periodic mode
        // reapply (and image pushes in custom mode) keep the Bluetooth link alive.

        // Handle different display modes
        if device_mode == "custom" && !enabled_pages.is_empty() {
            // Each page may override the global rotation time for how long it stays up.
            current_page_index %= enabled_pages.len();
            let display_secs = enabled_pages[current_page_index]
                .duration_secs
                .filter(|secs| *secs > 0)
                .unwrap_or(rotation_time);

            if last_page_switch.elapsed().as_secs() >= display_secs {
                current_page_index = (current_page_index + 1) % enabled_pages.len();
                last_page_switch = Instant::now();
            }
            let page = &enabled_pages[current_page_index];

            if is_divoom_page_type(&page.page_type) {
                // Divoom native page within custom rotation: apply the device's
                // native mode for this page. The device renders it itself, so we
                // only (re)apply when the page changes or periodically as a
                // keep-alive — avoiding a per-tick set_mode spam.
                let page_changed = last_divoom_page_index != Some(current_page_index);
                let stale = last_divoom_page_apply
                    .map(|t| t.elapsed().as_secs() >= 10)
                    .unwrap_or(true);
                if page_changed || stale {
                    if let Ok(mut wrapper) = pixoo.lock() {
                        if let Some(p) = wrapper.get_mut() {
                            match apply_divoom_mode(p, page) {
                                Ok(_) => {
                                    consecutive_failures = 0;
                                    last_heartbeat = Instant::now();
                                    last_divoom_page_index = Some(current_page_index);
                                    last_divoom_page_apply = Some(Instant::now());
                                    if page_changed {
                                        info!(page = %page.name, "Applied Divoom page mode");
                                    } else {
                                        debug!(page = %page.name, "Reapplied Divoom page mode");
                                    }
                                }
                                Err(e) => {
                                    consecutive_failures += 1;
                                    last_heartbeat = Instant::now();
                                    last_divoom_page_apply = Some(Instant::now());
                                    error!(attempt = consecutive_failures, error = %e, "Failed to apply Divoom page mode");

                                    let error_str = e.to_string().to_lowercase();
                                    if error_str.contains("transport endpoint")
                                        || error_str.contains("not connected")
                                        || error_str.contains("connection")
                                        || error_str.contains("107")
                                    {
                                        warn!("Connection error applying Divoom page, forcing reconnect");
                                        *wrapper = PixooWrapper::new();
                                        try_reconnect(&pixoo, &config, &tool);
                                        consecutive_failures = 0;
                                    } else if consecutive_failures >= 3 {
                                        warn!("Multiple Divoom page failures, forcing reconnect");
                                        *wrapper = PixooWrapper::new();
                                        try_reconnect(&pixoo, &config, &tool);
                                        consecutive_failures = 0;
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                // Reset divoom-page tracking when showing a rendered page so the
                // next divoom page re-applies fresh.
                last_divoom_page_index = None;
                let _ = PageRenderer::render_page(page, &sys, Some(&token_manager))
                    .and_then(|img| {
                        match PageRenderer::push_image(&pixoo, img) {
                            Ok(_) => {
                                consecutive_failures = 0;
                                last_heartbeat = Instant::now();
                                Ok(())
                            }
                            Err(e) => {
                                consecutive_failures += 1;
                                error!(attempt = consecutive_failures, error = %e, "Failed to push image");

                                let error_str = e.to_string().to_lowercase();
                                if error_str.contains("connection lost") ||
                                   error_str.contains("transport endpoint") ||
                                   error_str.contains("not connected") {
                                    warn!("Connection lost during image push, triggering reconnect");
                                    try_reconnect(&pixoo, &config, &tool);
                                    consecutive_failures = 0;
                                } else if consecutive_failures >= 5 {
                                    warn!("Multiple image push failures, forcing reconnect");
                                    try_reconnect(&pixoo, &config, &tool);
                                    consecutive_failures = 0;
                                }
                                Err(e)
                            }
                        }
                    });
            }
        } else {
            // Divoom native mode (device-level). Reapplying the mode periodically
            // serves as both the display refresh and the connection heartbeat.
            let device_config = {
                let cfg = config.lock().unwrap();
                cfg.device_config.clone()
            };

            let current_mode = device_config.light_mode.clone();
            let mode_changed = current_mode != last_native_mode;
            let should_reapply = mode_changed
                || last_native_mode_applied
                    .map(|last| last.elapsed().as_secs() >= 10)
                    .unwrap_or(true);

            if should_reapply {
                last_native_mode = current_mode.clone();
                last_native_mode_applied = Some(Instant::now());
                if let Ok(mut wrapper) = pixoo.lock() {
                    if let Some(p) = wrapper.get_mut() {
                        match apply_divoom_mode_from_config(p, &device_config) {
                            Ok(_) => {
                                consecutive_failures = 0;
                                last_heartbeat = Instant::now();
                                if mode_changed {
                                    info!(mode = %device_config.light_mode, "Applied native mode");
                                } else {
                                    debug!(mode = %device_config.light_mode, "Reapplied native mode");
                                }
                            }
                            Err(e) => {
                                consecutive_failures += 1;
                                last_heartbeat = Instant::now();
                                error!(attempt = consecutive_failures, error = %e, "Failed to apply Divoom mode");

                                let error_str = e.to_string().to_lowercase();
                                if error_str.contains("transport endpoint")
                                    || error_str.contains("not connected")
                                    || error_str.contains("connection")
                                    || error_str.contains("107")
                                {
                                    warn!(
                                        "Connection error applying native mode, forcing reconnect"
                                    );
                                    *wrapper = PixooWrapper::new();
                                    try_reconnect(&pixoo, &config, &tool);
                                    consecutive_failures = 0;
                                } else if consecutive_failures >= 3 {
                                    warn!("Multiple native mode failures, forcing reconnect");
                                    *wrapper = PixooWrapper::new();
                                    try_reconnect(&pixoo, &config, &tool);
                                    consecutive_failures = 0;
                                }
                            }
                        }
                    }
                }
            }
        }

        let refresh_ms = {
            let cfg = config.lock().unwrap();
            cfg.refresh_interval_ms
        };
        thread::sleep(Duration::from_millis(refresh_ms));
    }
}

pub fn try_reconnect(
    pixoo: &Arc<Mutex<PixooWrapper>>,
    config: &Arc<Mutex<Config>>,
    tool: &Arc<Mutex<ToolTimer>>,
) {
    let (mac_str, device_config) = {
        let cfg = config.lock().unwrap();
        (cfg.pixoo_mac.clone(), cfg.device_config.clone())
    };

    if mac_str.trim().is_empty() {
        warn!("Cannot reconnect: No MAC address configured");
        return;
    }

    // Only a tool that is still running keeps us from applying the config; one
    // that just ended should get its display back at once.
    let tool_recently_active = tool.lock().unwrap().is_active();
    // With the close-the-link fallback the device may need a moment after a tool,
    // so retry on a short fixed delay instead of backing off.
    let fixed_retry = ToolLink::from_env() == ToolLink::Close;

    info!(mac = %mac_str, tool_recently_active, "Attempting to reconnect to device");

    match BtAddr::from_str(&mac_str) {
        Ok(bt_addr) => {
            for attempt in 1..=8 {
                match Pixoo::connect(bt_addr) {
                    Ok(mut new_pixoo) => {
                        // Only apply device config if a tool wasn't recently active
                        // This prevents interrupting countdown, noise meter, etc.
                        if !tool_recently_active {
                            if let Err(e) = apply_device_config(&mut new_pixoo, &device_config) {
                                error!(error = %e, "Failed to apply device configuration during reconnect");
                            }
                        } else {
                            info!("Skipping device config application - tool was recently active");
                        }

                        if let Ok(mut wrapper) = pixoo.lock() {
                            wrapper.replace(new_pixoo);

                            info!(mac = %mac_str, attempt, "Successfully reconnected to device");
                            return;
                        }
                    }
                    Err(e) => {
                        let error_str = e.to_string().to_lowercase();
                        error!(attempt, mac = %mac_str, error = %e, "Reconnect attempt failed");

                        if error_str.contains("transport endpoint")
                            || error_str.contains("not connected")
                            || error_str.contains("connection")
                            || error_str.contains("107")
                        {
                            debug!("Connection error detected, will retry with backoff");
                        }

                        if attempt < 8 {
                            let delay = if fixed_retry {
                                Duration::from_secs(2)
                            } else {
                                Duration::from_secs(std::cmp::min(2_u64.pow(attempt as u32), 30))
                            };
                            debug!(?delay, "Waiting before next reconnect attempt");
                            thread::sleep(delay);
                        }
                    }
                }
            }
            error!(mac = %mac_str, "All reconnection attempts failed for device");
        }
        Err(_) => {
            error!(mac = %mac_str, "Invalid MAC address");
        }
    }
}
