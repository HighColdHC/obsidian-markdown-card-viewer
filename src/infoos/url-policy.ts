import { InfoOSPluginError } from "./contracts";

const API_PATH = "/api/plugin/v1";

export function normalizeInfoOSApiBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InfoOSPluginError("invalid_config", "请填写 InfoOS 请求地址。");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InfoOSPluginError("invalid_config", "InfoOS 请求地址不是有效 URL。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InfoOSPluginError("invalid_config", "InfoOS 请求地址只支持 HTTP 或 HTTPS。");
  }
  if (url.username || url.password) {
    throw new InfoOSPluginError("invalid_config", "请求地址不能包含用户名或密码。");
  }
  if (url.search || url.hash) {
    throw new InfoOSPluginError("invalid_config", "请求地址不能包含查询参数或锚点。");
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new InfoOSPluginError(
      "insecure_url",
      "远程 InfoOS 必须使用 HTTPS；HTTP 只允许 localhost 或 127.0.0.1 SSH 隧道。"
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== API_PATH) {
    throw new InfoOSPluginError(
      "invalid_config",
      `请求地址只能填写服务根地址或 ${API_PATH}。`
    );
  }
  url.pathname = API_PATH;
  return url.toString().replace(/\/$/, "");
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}
