import { Setting, Notice, Modal, App, Platform } from "obsidian";
import { t } from "src/i18n";
import type { ApiProviderConfig, ApiProviderType } from "src/types";
import { KNOWN_PROVIDER_DEFAULTS } from "src/types";
import { verifyApiProvider } from "src/core/openaiProvider";
import type { SettingsContext } from "./settingsContext";

export function displayApiProviderSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  if (Platform.isMobile) return;

  const { plugin, display } = ctx;
  const app = plugin.app;

  new Setting(containerEl).setName(t("settings.apiProviders")).setHeading();

  new Setting(containerEl)
    .setDesc(t("settings.apiProviders.desc"));

  // List existing providers
  for (const provider of plugin.settings.apiProviders) {
    const modelInfo = provider.defaultModel ? ` (${provider.defaultModel})` : "";
    const providerSetting = new Setting(containerEl)
      .setName(`${provider.name}${modelInfo}`)
      .setDesc(provider.baseUrl);

    const statusEl = providerSetting.controlEl.createDiv({ cls: "gemini-helper-cli-row-status" });
    if (provider.verified && provider.enabled) {
      statusEl.addClass("gemini-helper-cli-status--success");
      statusEl.textContent = t("settings.cliVerified");
    } else if (!provider.enabled) {
      statusEl.textContent = t("settings.apiProviderDisabled");
    }

    // Toggle enable/disable
    providerSetting.addToggle((toggle) =>
      toggle
        .setValue(provider.enabled)
        .onChange(async (value) => {
          provider.enabled = value;
          await plugin.saveSettings();
          display();
        })
    );

    // Edit button
    providerSetting.addExtraButton((button) =>
      button
        .setIcon("settings")
        .setTooltip(t("settings.apiProviderEdit"))
        .onClick(() => {
          new ApiProviderModal(app, provider, async (updated) => {
            const idx = plugin.settings.apiProviders.findIndex(p => p.id === provider.id);
            if (idx >= 0) {
              plugin.settings.apiProviders[idx] = updated;
              await plugin.saveSettings();
              display();
            }
          }).open();
        })
    );

    // Delete button
    providerSetting.addExtraButton((button) =>
      button
        .setIcon("trash")
        .setTooltip(t("settings.apiProviderDelete"))
        .onClick(async () => {
          plugin.settings.apiProviders = plugin.settings.apiProviders.filter(p => p.id !== provider.id);
          await plugin.saveSettings();
          display();
        })
    );
  }

  // Add new provider button
  new Setting(containerEl)
    .addButton((btn) =>
      btn
        .setButtonText(t("settings.apiProviderAdd"))
        .setCta()
        .onClick(() => {
          const newProvider: ApiProviderConfig = {
            id: `provider_${Date.now()}`,
            name: "",
            type: "openai",
            baseUrl: KNOWN_PROVIDER_DEFAULTS.openai.baseUrl,
            apiKey: "",
            defaultModel: "",
            availableModels: [],
            verified: false,
            enabled: true,
          };
          new ApiProviderModal(app, newProvider, async (created) => {
            plugin.settings.apiProviders.push(created);
            await plugin.saveSettings();
            display();
          }).open();
        })
    );
}

class ApiProviderModal extends Modal {
  private config: ApiProviderConfig;
  private onSave: (config: ApiProviderConfig) => Promise<void>;

  constructor(app: App, config: ApiProviderConfig, onSave: (config: ApiProviderConfig) => Promise<void>) {
    super(app);
    this.config = { ...config };
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("settings.apiProviderConfigure") });

    // Provider type
    new Setting(contentEl)
      .setName(t("settings.apiProviderType"))
      .addDropdown((dropdown) => {
        dropdown.addOption("openai", "OpenAI");
        dropdown.addOption("openrouter", "OpenRouter");
        dropdown.addOption("grok", "Grok");
        dropdown.addOption("custom", t("settings.apiProviderCustom"));
        dropdown.setValue(this.config.type);
        dropdown.onChange((value) => {
          this.config.type = value as ApiProviderType;
          const defaults = KNOWN_PROVIDER_DEFAULTS[value];
          if (defaults) {
            this.config.baseUrl = defaults.baseUrl;
            if (!this.config.name) {
              this.config.name = defaults.displayName;
            }
          }
          this.onOpen(); // Re-render
        });
      });

    // Name
    new Setting(contentEl)
      .setName(t("settings.apiProviderName"))
      .addText((text) =>
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder("My Provider")
          .setValue(this.config.name)
          .onChange((value) => { this.config.name = value.trim(); })
      );

    // Base URL
    new Setting(contentEl)
      .setName(t("settings.apiProviderBaseUrl"))
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com")
          .setValue(this.config.baseUrl)
          .onChange((value) => { this.config.baseUrl = value.trim(); })
      );

    // API Key
    new Setting(contentEl)
      .setName(t("settings.apiProviderApiKey"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.googleApiKey.placeholder"))
          .setValue(this.config.apiKey)
          .onChange((value) => { this.config.apiKey = value.trim(); });
        text.inputEl.type = "password";
      });

    // Model (text input, can be verified)
    new Setting(contentEl)
      .setName(t("settings.apiProviderModel"))
      .setDesc(t("settings.apiProviderModel.desc"))
      .addText((text) =>
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder("gpt-4o")
          .setValue(this.config.defaultModel)
          .onChange((value) => { this.config.defaultModel = value.trim(); })
      );

    // Available models (read-only list after verify)
    if (this.config.availableModels.length > 0) {
      const modelListSetting = new Setting(contentEl)
        .setName(t("settings.apiProviderAvailableModels"))
        .setDesc(this.config.availableModels.slice(0, 20).join(", ") +
          (this.config.availableModels.length > 20 ? ` (+${this.config.availableModels.length - 20} more)` : ""));
      modelListSetting.settingEl.addClass("gemini-helper-settings-textarea-container");
    }

    // Buttons: Verify + Save
    const buttonSetting = new Setting(contentEl);

    buttonSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.apiProviderVerify"))
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText(t("settings.cliVerifying"));
          try {
            const result = await verifyApiProvider(this.config.baseUrl, this.config.apiKey);
            if (result.success) {
              this.config.verified = true;
              this.config.availableModels = result.models || [];
              if (!this.config.defaultModel && this.config.availableModels.length > 0) {
                this.config.defaultModel = this.config.availableModels[0];
              }
              new Notice(t("settings.apiProviderVerified", { count: String(this.config.availableModels.length) }));
              this.onOpen(); // Re-render with models
            } else {
              new Notice(t("settings.apiProviderVerifyFailed", { error: result.error || "Unknown error" }));
            }
          } catch (error) {
            new Notice(t("settings.apiProviderVerifyFailed", { error: error instanceof Error ? error.message : String(error) }));
          } finally {
            btn.setDisabled(false);
            btn.setButtonText(t("settings.apiProviderVerify"));
          }
        })
    );

    buttonSetting.addButton((btn) =>
      btn
        .setButtonText(t("common.save"))
        .setCta()
        .onClick(async () => {
          if (!this.config.name) {
            new Notice(t("settings.apiProviderNameRequired"));
            return;
          }
          if (!this.config.apiKey) {
            new Notice(t("settings.apiProviderApiKeyRequired"));
            return;
          }
          await this.onSave(this.config);
          this.close();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
