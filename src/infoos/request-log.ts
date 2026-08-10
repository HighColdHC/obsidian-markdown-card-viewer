export type InfoOSRequestLogOutcome = "success" | "http_error" | "network_error";

export type InfoOSRequestLogEntry = {
  timestamp: string;
  method: string;
  route: string;
  status: number | null;
  durationMs: number;
  outcome: InfoOSRequestLogOutcome;
};

export const INFOOS_REQUEST_LOG_LIMIT = 100;

/**
 * Keeps only diagnostic shape: host, identifiers, query values, credentials,
 * bodies, and transport error text are deliberately excluded.
 */
export function sanitizeInfoOSRequestLogRoute(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const route = url.pathname
      .replace(/\/cards\/[^/]+$/, "/cards/:card_id")
      .replace(/\/assets\/[^/]+$/, "/assets/:asset_id");
    const queryNames = [...new Set(url.searchParams.keys())].sort();
    return queryNames.length ? `${route}?${queryNames.join("&")}` : route;
  } catch {
    return "invalid-url";
  }
}

export function appendInfoOSRequestLog(
  entries: readonly InfoOSRequestLogEntry[],
  entry: InfoOSRequestLogEntry,
  limit = INFOOS_REQUEST_LOG_LIMIT
): InfoOSRequestLogEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return [...entries, entry].slice(-safeLimit);
}
