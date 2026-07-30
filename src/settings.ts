import { Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import type { CardViewerSettings } from "./settings-model";

export * from "./settings-model";

export interface SettingsHost {
  settings: CardViewerSettings;
  requestSaveSettings(): void;
  saveSettings(): Promise<void>;
  refreshViews(): void;
  testInfoOSConnection(): Promise<string>;
}

export class CardViewerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Markdown Card Viewer" });
    containerEl.createEl("p", {
      text: "现有 Markdown 始终只读。InfoOS 使用远端目录与明确选择的薄物化，不会自动写入 Vault。"
    });

    containerEl.createEl("h3", { text: "InfoOS 远端目录" });
    containerEl.createEl("p", {
      text: "在 InfoOS 标签页明确刷新目录、选择“收下”卡片，并按需离线保存资产。不会回写、远程删除或定时同步。"
    });

    new Setting(containerEl)
      .setName("请求地址")
      .setDesc("填写 HTTPS 服务地址，或通过 SSH 隧道填写 http://127.0.0.1:端口。")
      .addText((text) => text
        .setPlaceholder("https://infoos.example.com")
        .setValue(this.host.settings.infoOSBaseUrl)
        .onChange((value) => {
          this.host.settings.infoOSBaseUrl = value.trim();
          this.host.requestSaveSettings();
        }));

    new Setting(containerEl)
      .setName("Token")
      .setDesc("需要 cards:read 和 assets:read 权限；Token 会保存在本地插件数据文件中。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("InfoOS API Token")
          .setValue(this.host.settings.infoOSToken)
          .onChange((value) => {
            this.host.settings.infoOSToken = value.trim();
            this.host.requestSaveSettings();
          });
      });

    new Setting(containerEl)
      .setName("目标文件夹")
      .setDesc("收下的卡片写入 Cards，明确离线保存的附件写入 Assets；不会覆盖非受管文件。")
      .addText((text) => text
        .setPlaceholder("InfoOS")
        .setValue(this.host.settings.infoOSTargetFolder)
        .onChange((value) => {
          this.host.settings.infoOSTargetFolder = value.trim();
          this.host.requestSaveSettings();
        }));

    const status = containerEl.createDiv({ cls: "setting-item-description" });
    const lastSync = this.host.settings.infoOSSyncState.catalog?.refreshedAt;
    status.setText(lastSync ? `上次刷新远端目录：${new Date(lastSync).toLocaleString()}` : "尚未刷新远端目录。");

    new Setting(containerEl)
      .setName("连接")
      .setDesc("测试会验证 cards:read 并报告 assets:read；目录刷新与收下操作在 InfoOS 标签页完成。")
      .addButton((button) => button
        .setButtonText("测试连接")
        .onClick(async () => {
          button.setDisabled(true);
          status.setText("正在测试连接…");
          try {
            status.setText(await this.host.testInfoOSConnection());
          } catch (error) {
            status.setText(errorMessage(error));
          } finally {
            button.setDisabled(false);
          }
        }));

    containerEl.createEl("h3", { text: "卡片显示" });

    new Setting(containerEl)
      .setName("卡片宽度")
      .setDesc("全局卡片宽度，单位为像素。")
      .addSlider((slider) => slider
        .setLimits(260, 560, 10)
        .setValue(this.host.settings.cardWidth)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.host.settings.cardWidth = value;
          await this.host.saveSettings();
          this.host.refreshViews();
        }));

    new Setting(containerEl)
      .setName("卡片高度")
      .setDesc("全局卡片高度；长文在卡片内部滚动。")
      .addSlider((slider) => slider
        .setLimits(320, 760, 20)
        .setValue(this.host.settings.cardHeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.host.settings.cardHeight = value;
          await this.host.saveSettings();
          this.host.refreshViews();
        }));

    new Setting(containerEl)
      .setName("卡片间距")
      .setDesc("网格和瀑布流中卡片之间的距离。")
      .addSlider((slider) => slider
        .setLimits(8, 32, 2)
        .setValue(this.host.settings.gap)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.host.settings.gap = value;
          await this.host.saveSettings();
          this.host.refreshViews();
        }));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请检查配置。";
}
