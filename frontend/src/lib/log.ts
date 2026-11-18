/* Tiny console wrapper: silent in production builds. */
/** Logs an error with context; a no-op in production builds. */
export function logError(message: string, err?: unknown): void {
  if (!import.meta.env.PROD) console.error(`[xray] ${message}`, err ?? "");
}
