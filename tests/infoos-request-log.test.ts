import { describe, expect, it } from "vitest";
import {
  appendInfoOSRequestLog,
  sanitizeInfoOSRequestLogRoute,
  type InfoOSRequestLogEntry
} from "../src/infoos/request-log";

const entry = (index: number): InfoOSRequestLogEntry => ({
  timestamp: `2026-07-30T00:00:${String(index).padStart(2, "0")}Z`,
  method: "GET",
  route: "/api/plugin/v1/health",
  status: 200,
  durationMs: index,
  outcome: "success"
});

describe("InfoOS request log", () => {
  it("removes host, identifiers, and query values while preserving diagnostic shape", () => {
    const route = sanitizeInfoOSRequestLogRoute(
      "https://private.infoos.test/api/plugin/v1/cards/card-secret?query=private+body&page_token=secret"
    );
    expect(route).toBe("/api/plugin/v1/cards/:card_id?page_token&query");
    expect(route).not.toContain("private.infoos.test");
    expect(route).not.toContain("card-secret");
    expect(route).not.toContain("private+body");
    expect(route).not.toContain("secret");
    expect(sanitizeInfoOSRequestLogRoute(
      "https://private.infoos.test/api/plugin/v1/assets/asset-secret"
    )).toBe("/api/plugin/v1/assets/:asset_id");
  });

  it("keeps a bounded chronological ring without mutating previous entries", () => {
    const original = [entry(0)];
    const result = [1, 2, 3].reduce(
      (logs, index) => appendInfoOSRequestLog(logs, entry(index), 3),
      original
    );
    expect(original).toHaveLength(1);
    expect(result.map((item) => item.durationMs)).toEqual([1, 2, 3]);
  });
});
