/**
 * Next.js Instrumentation
 * This file runs once when the server starts.
 * Used for startup logging and configuration validation.
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfig, logConfig } = await import("./lib/config");

    console.log("Starting Macroscope PR Creator...");
    validateConfig();
    logConfig();
  }
}
