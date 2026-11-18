/* Tiny console wrapper: silent in production builds. */
/** Logs an error with context; a no-op in production builds. */
export function logError(message: string, err?: unknown): void {
  if (!import.meta.env.PROD) console.error(`[xray] ${message}`, err ?? "");
}

/** Logs a debug-level state change (sweep start, cancel, end); a no-op in production builds. */
export function logDebug(message: string, detail?: unknown): void {
  if (!import.meta.env.PROD) console.debug(`[xray] ${message}`, detail ?? "");
}
