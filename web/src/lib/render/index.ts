// Render one custom page to a 16x16 frame. Port of pages/mod.rs.

import type { TokenManager } from "./beszel";
import { Canvas } from "./canvas";
import type { CustomPage } from "./pageTypes";
import { renderClockWeather } from "./pages/clockWeather";
import { renderCustomScript, renderImageUpload } from "./pages/media";
import { renderCustomPixels, renderCustomText } from "./pages/simple";
import { drawGpuStats, drawSystemStats, drawTemps, gpuLoad, systemStats, temps } from "./pages/stats";

export interface RenderContext {
  timeZone: string;
  tokens: TokenManager | null;
}

export async function renderPage(page: CustomPage, ctx: RenderContext): Promise<Canvas> {
  const p = page.page_type;
  switch (p.type) {
    case "ClockWeather":
      return renderClockWeather(p, ctx.timeZone);
    case "SystemStats":
      return drawSystemStats(p, await systemStats(p, ctx.tokens));
    case "GpuStats":
      return drawGpuStats(p, await gpuLoad(p, ctx.tokens));
    case "Temps":
      return drawTemps(p, await temps(p, ctx.tokens));
    case "CustomScript":
      return renderCustomScript(p.script_path, p.inputs);
    case "ImageUpload":
      return renderImageUpload(p.mode, p.file_path, Number(p.frame_duration) || 0);
    case "CustomPixels":
      return renderCustomPixels(p.pixels);
    case "CustomText":
      return renderCustomText(p);
    default:
      // Divoom pages are applied as native modes, not rendered.
      return new Canvas();
  }
}
