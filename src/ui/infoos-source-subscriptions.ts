import type { InfoOSSourceSubscription } from "../infoos/contracts";
import { visibleSources } from "../infoos/source-subscriptions";
import { renderInfoOSPagination } from "./infoos-pagination";

export function renderInfoOSSourceSubscriptionPanel(parent: HTMLElement, input: {
  subscription: InfoOSSourceSubscription;
  selected: ReadonlySet<string>;
  mode: "all" | "selected";
  query: string;
  platform: string;
  page: number;
  busy: boolean;
  onQuery(query: string): void;
  onPlatform(platform: string): void;
  onMode(mode: "all" | "selected"): void;
  onToggle(id: string, checked: boolean): void;
  onSelectVisible(ids: readonly string[]): void;
  onClear(): void;
  onPage(page: number): void;
  onRefresh(): void;
  onSave(): void;
}): void {
  parent.createDiv({ cls: "infoos-summary", text: "信息源选择仅保存在此插件数据中；刷新需手动执行，且不会写入 Vault。" });
  const controls = parent.createDiv({ cls: "infoos-controls" });
  const search = controls.createEl("input", { attr: { type: "search", placeholder: "筛选名称或类型" } });
  search.value = input.query;
  search.addEventListener("change", () => input.onQuery(search.value));
  const platforms = [...new Set(Object.values(input.subscription.catalog).map((source) => source.platform))].sort((a, b) => a.localeCompare(b));
  const platform = controls.createEl("select", { attr: { "aria-label": "信息源平台" } });
  platform.createEl("option", { text: "所有平台", value: "" });
  platforms.forEach((value) => platform.createEl("option", { text: value, value }));
  platform.value = input.platform;
  platform.addEventListener("change", () => input.onPlatform(platform.value));
  const refresh = controls.createEl("button", { text: input.busy ? "处理中…" : "刷新信息源", cls: "mod-cta", attr: { type: "button" } });
  refresh.disabled = input.busy;
  refresh.addEventListener("click", input.onRefresh);
  const modes = parent.createDiv({ cls: "infoos-source-mode" });
  (["all", "selected"] as const).forEach((mode) => {
    const label = modes.createEl("label");
    const radio = label.createEl("input", { attr: { type: "radio", name: "infoos-source-mode", value: mode } });
    radio.checked = input.mode === mode;
    radio.disabled = input.busy;
    radio.addEventListener("change", () => input.onMode(mode));
    label.appendText(mode === "all" ? "全部信息源" : "仅选中信息源");
  });
  const visible = visibleSources(input.subscription, input.query, input.platform);
  const action = parent.createDiv({ cls: "infoos-actionbar" });
  action.setText(`缓存 ${input.subscription.order.length} 个，显示 ${visible.length} 个，已选 ${input.selected.size} 个。`);
  const select = action.createEl("button", { text: "全选可见", attr: { type: "button" } });
  select.disabled = input.busy || !visible.length;
  select.addEventListener("click", () => input.onSelectVisible(visible.map((source) => source.source_id)));
  const clear = action.createEl("button", { text: "清除选择", attr: { type: "button" } });
  clear.disabled = input.busy || !input.selected.size;
  clear.addEventListener("click", input.onClear);
  const save = action.createEl("button", { text: "保存选择", cls: "mod-cta", attr: { type: "button" } });
  save.disabled = input.busy;
  save.addEventListener("click", input.onSave);
  if (!visible.length) {
    parent.createDiv({ cls: "infoos-empty", text: input.subscription.order.length ? "没有符合当前筛选的信息源。" : "尚未缓存信息源。点击“刷新信息源”后才会请求 InfoOS。" });
    return;
  }
  const page = renderInfoOSPagination(parent, visible.length, input.page, input.onPage, "信息源分页");
  const list = parent.createDiv({ cls: "infoos-source-list" });
  visible.slice(page.start, page.end).forEach((source) => {
    const row = list.createDiv({ cls: "infoos-source-row" });
    const check = row.createEl("input", { attr: { type: "checkbox", "aria-label": `选择 ${source.display_name}` } });
    check.checked = input.selected.has(source.source_id);
    check.disabled = input.busy;
    check.addEventListener("change", () => input.onToggle(source.source_id, check.checked));
    const content = row.createDiv({ cls: "infoos-card-content" });
    content.createEl("strong", { text: source.display_name || source.source_id });
    content.createDiv({ cls: "infoos-meta", text: `${source.platform} · ${source.source_type} · ${source.card_count} 张卡片` });
  });
}
