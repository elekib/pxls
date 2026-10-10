// Runs once when the Next.js server starts: opens the database (running any
// migrations), prints the setup code if no accounts exist, and brings up the
// display engine in the same process as the UI and API.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAccounts } = await import("@/lib/auth");
  getAccounts();
  // Webhooks without a secret get one, so senders can be configured for them.
  const { getDb } = await import("@/lib/db/sqlite");
  const { ensureSecrets } = await import("@/lib/webhooks/store");
  const n = ensureSecrets(getDb());
  if (n) console.warn(`Generated secrets for ${n} webhook(s); copy them into the senders.`);
  const { getEngine } = await import("@/lib/engine/engine");
  getEngine().start();
}
