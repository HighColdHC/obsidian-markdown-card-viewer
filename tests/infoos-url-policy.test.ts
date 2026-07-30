import { describe, expect, it } from "vitest";
import { normalizeInfoOSApiBaseUrl } from "../src/infoos/url-policy";

describe("normalizeInfoOSApiBaseUrl", () => {
  it("accepts HTTPS origins and normalizes the plugin API path", () => {
    expect(normalizeInfoOSApiBaseUrl("https://infoos.example.com/"))
      .toBe("https://infoos.example.com/api/plugin/v1");
    expect(normalizeInfoOSApiBaseUrl("https://infoos.example.com/api/plugin/v1/"))
      .toBe("https://infoos.example.com/api/plugin/v1");
  });

  it("accepts loopback HTTP for an SSH tunnel", () => {
    expect(normalizeInfoOSApiBaseUrl("http://127.0.0.1:18000"))
      .toBe("http://127.0.0.1:18000/api/plugin/v1");
    expect(normalizeInfoOSApiBaseUrl("http://localhost:18000/api/plugin/v1"))
      .toBe("http://localhost:18000/api/plugin/v1");
  });

  it("rejects plaintext remote HTTP and credential-bearing URLs", () => {
    expect(() => normalizeInfoOSApiBaseUrl("http://192.168.31.102:8000"))
      .toThrowError(/HTTPS/);
    expect(() => normalizeInfoOSApiBaseUrl("https://user:pass@example.com"))
      .toThrowError(/用户名或密码/);
    expect(() => normalizeInfoOSApiBaseUrl("https://example.com?token=secret"))
      .toThrowError(/查询参数/);
  });
});
