// Runs once when the Next.js server starts: opens the database (running any
// migrations), prints the setup code if no accounts exist, and brings up the
// display engine in the same process as the UI and API.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAuth } = await import("@/lib/auth");
  getAuth();
  const { getEngine } = await import("@/lib/engine/engine");
  getEngine().start();
}
