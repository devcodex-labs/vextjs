import type { VextApp } from "../types/app.js";

type StartupLoggerApp = Pick<VextApp, "logger">;

/**
 * Temporarily raises startup noise to warn level, then restores only if no user
 * code changed the runtime logger level during bootstrap/onReady.
 */
export function quietStartupLogger(
  app: StartupLoggerApp,
  enabled: boolean,
): () => void {
  if (!enabled) {
    return () => {};
  }

  const originalLevel = app.logger.getLevel();
  app.logger.setLevel("warn");

  return () => {
    if (app.logger.getLevel() === "warn") {
      app.logger.setLevel(originalLevel);
    }
  };
}
