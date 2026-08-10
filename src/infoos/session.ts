import { InfoOSPluginError, type InfoOSCapabilities } from "./contracts";
import { normalizeInfoOSApiBaseUrl } from "./url-policy";

export class InfoOSSession {
  private running = false;
  private readonly capabilitiesByApiBaseUrl = new Map<string, InfoOSCapabilities>();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new InfoOSPluginError("sync_busy", "已有 InfoOS 操作正在进行。");
    }
    this.running = true;
    try {
      return await operation();
    } finally {
      this.running = false;
    }
  }

  rememberCapabilities(apiBaseUrl: string, capabilities: InfoOSCapabilities): void {
    this.capabilitiesByApiBaseUrl.set(normalizeInfoOSApiBaseUrl(apiBaseUrl), capabilities);
  }

  webDeepLinksEnabled(apiBaseUrl: string): boolean {
    return this.capabilitiesByApiBaseUrl.get(normalizeInfoOSApiBaseUrl(apiBaseUrl))
      ?.web_deep_links === true;
  }
}
