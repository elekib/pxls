// Run a webhook action.

import type { Json, Action } from "./model";
import { extractFieldAsString, substitutePlaceholders, type DisplayDefaults } from "./match";
import { processImageAction, type Rgba } from "./images";
import type { NotificationManager } from "./notifications";

export interface ActionContext {
  notifications: NotificationManager;
  buzzer: (totalMs: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

const str = (a: Action, k: string) => (typeof a.parameters[k] === "string" ? (a.parameters[k] as string) : undefined);
function u64(a: Action, k: string): number | undefined {
  const v = a.parameters[k];
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return undefined;
}
function bool(a: Action, k: string): boolean | undefined {
  const v = a.parameters[k];
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && (v.trim() === "true" || v.trim() === "false")) return v.trim() === "true";
  return undefined;
}

/** A text parameter with placeholders filled, else the default field from the payload. */
function resolveText(a: Action, key: string, defaultField: string, payload: Json): string | undefined {
  const raw = str(a, key);
  if (raw !== undefined) {
    const r = substitutePlaceholders(raw, payload);
    if (r) return r;
  }
  if (defaultField) {
    const v = extractFieldAsString(payload, defaultField);
    if (v) return v;
  }
  return undefined;
}

export async function executeAction(a: Action, payload: Json, d: DisplayDefaults, ctx: ActionContext): Promise<string> {
  switch (a.action_type) {
    case "DisplayNotification": {
      const title = resolveText(a, "title", d.title_field, payload) ?? "Notification";
      const subtitle = resolveText(a, "subtitle", d.subtitle_field, payload) ?? "";
      const iconUrl = resolveText(a, "icon_image_url", "", payload) || d.icon_image_url || "";
      let iconImage: Rgba | null = null;
      if (iconUrl) {
        try {
          iconImage = await processImageAction({ action_type: "DisplayImage", parameters: { image_source: "url", url: iconUrl, width: 8, height: 8 } }, payload);
        } catch (e) {
          console.warn(`[webhook] failed to load icon image: ${(e as Error).message}`);
        }
      }
      ctx.notifications.trigger({
        title,
        subtitle,
        icon: str(a, "icon") ?? d.icon,
        iconImage,
        durationSecs: u64(a, "duration_secs") ?? d.duration_secs,
        displayMode: str(a, "display_mode") ?? d.display_mode,
        backgroundColor: str(a, "background_color") ?? d.background_color,
        textColor: str(a, "text_color") ?? d.text_color,
        flash: bool(a, "flash") ?? d.flash,
        flashSpeedMs: u64(a, "flash_speed_ms") ?? d.flash_speed_ms,
      });
      return `Displayed notification: ${title}`;
    }
    case "DisplayImage": {
      const source = str(a, "image_source") ?? "url";
      const effective: Action = { ...a, parameters: { ...a.parameters, image_source: source } };
      if (source === "url") {
        const fromUrl = str(a, "url") !== undefined ? substitutePlaceholders(str(a, "url")!, payload) : "";
        const fromField = str(a, "url_field") !== undefined ? extractFieldAsString(payload, str(a, "url_field")!) : undefined;
        const fromDefault = d.image_url_field ? extractFieldAsString(payload, d.image_url_field) : undefined;
        const url = fromUrl || fromField || fromDefault;
        if (!url) throw new Error("DisplayImage: no image URL (set 'url' or 'url_field' parameter)");
        effective.parameters.url = url;
      }
      let img: Rgba;
      try {
        img = await processImageAction(effective, payload);
      } catch (e) {
        throw new Error(`Failed to process image action: ${(e as Error).message}`);
      }
      ctx.notifications.triggerImage(img, u64(a, "duration_secs") ?? d.duration_secs, bool(a, "flash") ?? d.flash, u64(a, "flash_speed_ms") ?? d.flash_speed_ms);
      return `Displayed image from source: ${source}`;
    }
    case "FlashScreen": {
      const color = str(a, "color") ?? "FFFFFF";
      const durationMs = u64(a, "duration_ms") ?? 500;
      const speed = u64(a, "flash_speed_ms") ?? d.flash_speed_ms;
      let rgb = parseInt(color.replace(/^#/, ""), 16);
      if (!/^#?[0-9a-fA-F]{1,8}$/.test(color) || Number.isNaN(rgb)) rgb = 0xffffff;
      const data = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < 256; i++) data.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], i * 4);
      ctx.notifications.triggerImage({ width: 16, height: 16, data }, Math.max(1, Math.ceil(durationMs / 1000)), true, Math.max(50, speed));
      return `Flashed screen with color ${color} for ${durationMs}ms`;
    }
    case "PlaySound": {
      const type = str(a, "sound_type") ?? "default";
      const preset = type === "short" ? 200 : type === "beep" ? 500 : type === "alarm" ? 3000 : 1000;
      const total = (u64(a, "total_time_ms") ?? preset) & 0xffff;
      try {
        await ctx.buzzer(total);
      } catch (e) {
        throw new Error(`Failed to play buzzer: ${(e as Error).message}`);
      }
      return `Played sound ${type} for ${total}ms`;
    }
    case "LogEvent": {
      const message = (str(a, "message") !== undefined ? substitutePlaceholders(str(a, "message")!, payload) : "") || "Event logged";
      const level = str(a, "level") ?? "info";
      (level === "error" ? console.error : level === "warn" || level === "warning" ? console.warn : console.log)(`[webhook] ${message}`);
      return `Logged event: ${message}`;
    }
    case "ForwardWebhook": {
      const url = str(a, "url") !== undefined ? substitutePlaceholders(str(a, "url")!, payload) : "";
      if (!url) throw new Error("Forward webhook requires url parameter");
      const method = (str(a, "method") ?? "POST").toUpperCase();
      if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw new Error(`Unsupported HTTP method: ${method}`);
      // Webhook URLs often embed a secret token; report only the host.
      let target = "unknown host";
      try {
        target = new URL(url).host || target;
      } catch {
        // keep "unknown host"
      }
      const withBody = method === "POST" || method === "PUT";
      let r: Response;
      try {
        r = await (ctx.fetchFn ?? fetch)(url, {
          method,
          headers: withBody ? { "content-type": "application/json" } : {},
          body: withBody ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.timeout(10_000),
          redirect: "follow",
        });
      } catch (e) {
        throw new Error(`Forward to ${target} failed: ${(e as Error).name === "TimeoutError" ? "timed out" : "request failed"}`);
      }
      const status = `${r.status} ${r.statusText}`.trim();
      if (!r.ok) throw new Error(`Forward to ${target} returned ${status}`);
      return `Forwarded webhook to ${target} (status: ${status})`;
    }
  }
}
