import { describe, expect, it } from "vitest";
import { clockParts, drawClockWeather } from "@/lib/render/pages/clockWeather";
import { gifFrameIndex } from "@/lib/render/pages/media";
import { renderCustomPixels, renderCustomText } from "@/lib/render/pages/simple";
import { drawGpuStats, drawSystemStats, drawTemps, tempColor, usageColor } from "@/lib/render/pages/stats";
import { Canvas } from "@/lib/render/canvas";
import { drawText } from "@/lib/render/font";

const page = { clock_color: "00FFFF", date_color: "FFFF00", weather_color: "FFA500", weather_location: "X", temperature_unit: "celsius" };
const same = (a: Canvas, b: Canvas) => expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);

describe("clock and weather", () => {
  it("reads clock fields in the saved timezone", () => {
    const d = new Date("2026-10-07T03:04:05Z");
    expect(clockParts(d, "America/New_York")).toEqual({ hour: "11", minute: "04", month: "Oct", day: "06", second: 5 });
    expect(clockParts(d, "Europe/London")).toMatchObject({ hour: "4", day: "07" });
    expect(clockParts(d, "Not/AZone").minute).toBe("04");
  });

  it("lays out time, date and temperature like the Rust page", () => {
    const t = { hour: "9", minute: "41", month: "Oct", day: "06", second: 2 };
    const got = drawClockWeather(page, t, { temp: "72", code: -1 }, 0);
    const want = new Canvas();
    drawText(want, "9", 0, 0, [0, 255, 255], 1);
    drawText(want, ":", 3, 0, [0, 255, 255], 1);
    drawText(want, "41", 4, 0, [0, 255, 255], 1);
    drawText(want, "Oct", 0, 5, [255, 255, 0], 0);
    drawText(want, "06", 9, 5, [255, 255, 0], 1);
    drawText(want, "72", 0, 11, [255, 165, 0], 1);
    drawText(want, "*", 8, 11, [255, 165, 0], 0);
    same(got, want);
  });

  it("blinks the colon and draws an icon only with a valid reading", () => {
    const t = { hour: "10", minute: "00", month: "Jan", day: "01", second: 1 };
    const noColon = drawClockWeather(page, t, { temp: "--", code: 0 }, 0);
    expect(noColon.get(7, 1)).toEqual([0, 0, 0]);
    const sunny = drawClockWeather(page, { ...t, second: 0 }, { temp: "5", code: 0 }, 0);
    expect(sunny.get(6, 11)).toEqual([255, 200, 0]); // icon at tempWidth(3) + 3; ray in its first column
  });
});

describe("text and pixels", () => {
  const text = { text: "HELLO WORLD", y: 5, color: "FFFFFF", background_color: "000080", scroll_speed: 100, enable_scroll: true };

  it("centres short text on the background", () => {
    const c = renderCustomText({ ...text, text: "HI", enable_scroll: false });
    expect(c.get(0, 0)).toEqual([0, 0, 128]);
    expect(c.get(7, 5)).toEqual([255, 255, 255]); // H starts at x=(16-2)/2=7
  });

  it("scrolls long text one character per scroll_speed ms", () => {
    const a = renderCustomText(text, 0);
    const b = renderCustomText(text, 100);
    const c = renderCustomText(text, 100 + 100 * 27);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
    same(b, c); // cycle: "HELLO WORLD" + 5 spaces + "HELLO WORLD" = 27 characters
  });

  it("only draws pixels inside the frame", () => {
    const c = renderCustomPixels([{ x: 1, y: 2, color: "#FF0000" }, { x: 16, y: 0, color: "00FF00" }]);
    expect(c.get(1, 2)).toEqual([255, 0, 0]);
    expect(c.data.filter((v) => v > 0)).toHaveLength(1);
  });
});

describe("stats pages", () => {
  const sp = { source: "dashdot", brand_text: "NAS", brand_color: "FFFFFF" };

  it("colours usage and temperatures by threshold", () => {
    expect([10, 60, 80, 95].map(usageColor)).toEqual([[0, 255, 0], [255, 255, 0], [255, 165, 0], [255, 0, 0]]);
    expect([50, 70, 85, 86].map(tempColor)).toEqual([[0, 255, 0], [255, 255, 0], [255, 165, 0], [255, 0, 0]]);
  });

  it("draws values or offline placeholders", () => {
    const want = new Canvas();
    drawText(want, "C5%", 0, 0, [0, 255, 0], 1);
    drawText(want, "R80%", 0, 6, [255, 165, 0], 1);
    drawText(want, "NAS", 0, 11, [255, 255, 255], 0);
    same(drawSystemStats(sp, { cpu: 5, ram: 80 }), want);
    expect(drawSystemStats(sp, { cpu: 5, ram: null }).get(0, 0)).toEqual([100, 100, 100]);
    expect(drawGpuStats(sp, null).get(0, 0)).toEqual([100, 100, 100]);
  });

  it("shows at most two temperatures", () => {
    const t = { ...sp, show_cpu: true, show_gpu: true, show_storage: true };
    const c = drawTemps(t, { cpu: 40, gpu: 90, storage: 30 });
    expect(c.get(0, 0)).toEqual([0, 255, 0]);
    expect(c.get(0, 6)).toEqual([255, 0, 0]);
    expect(drawTemps({ ...sp, show_cpu: false, show_gpu: false, show_storage: false }, { cpu: 1, gpu: 1, storage: 1 }).get(0, 0)).toEqual([100, 100, 100]);
  });
});

describe("GIF timing", () => {
  const gif = { frames: [new Canvas(), new Canvas(), new Canvas()], delays: [100, 200, 100] };
  it("follows native delays and loops", () => {
    expect([0, 99, 100, 299, 300, 399, 400].map((t) => gifFrameIndex(gif, t, 0))).toEqual([0, 0, 1, 1, 2, 2, 0]);
  });
  it("uses a fixed duration when set", () => {
    expect([0, 49, 50, 100, 150].map((t) => gifFrameIndex(gif, t, 50))).toEqual([0, 0, 1, 2, 0]);
  });
});
