// Runs once when the Next.js server starts: brings up the display engine in
// the same process as the UI and API.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEngine } = await import("@/lib/engine/engine");
  getEngine().start();
}
