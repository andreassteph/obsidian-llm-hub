import { Setting, Notice, Platform } from "obsidian";
import { t } from "src/i18n";
import { DEFAULT_LOCAL_LLM_CONFIG } from "src/types";
import { LocalLlmModal } from "./LocalLlmModal";
import type { SettingsContext } from "./settingsContext";

export function displayLocalLlmSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  if (Platform.isMobile) return;

  const { plugin, display } = ctx;
  const app = plugin.app;
  const llmConfig = plugin.settings.localLlmConfig || DEFAULT_LOCAL_LLM_CONFIG;

  new Setting(containerEl).setName(t("settings.localLlm")).setHeading();

  const modelInfo = llmConfig.model ? ` (${llmConfig.model})` : "";
  const setting = new Setting(containerEl)
    .setName(`Local LLM${modelInfo}`)
    .setDesc(t("settings.localLlmDesc"));

  const statusEl = setting.controlEl.createDiv({ cls: "gemini-helper-cli-row-status" });

  if (plugin.settings.localLlmVerified) {
    statusEl.addClass("gemini-helper-cli-status--success");
    statusEl.textContent = t("settings.cliVerified");
    setting.addButton((button) =>
      button
        .setButtonText(t("settings.cliDisable"))
        .onClick(async () => {
          plugin.settings.localLlmVerified = false;
          await plugin.saveSettings();
          display();
          new Notice(t("settings.localLlmDisabled"));
        })
    );
  }

  setting.addExtraButton((button) =>
    button
      .setIcon("settings")
      .setTooltip(t("settings.localLlmConfigure"))
      .onClick(() => {
        new LocalLlmModal(
          app,
          llmConfig,
          plugin.settings.localLlmAvailableModels || [],
          async (config, models) => {
            plugin.settings.localLlmConfig = config;
            plugin.settings.localLlmAvailableModels = models;
            plugin.settings.localLlmVerified = models.length > 0 && !!config.model;
            await plugin.saveSettings();
            display();
            new Notice(t("settings.localLlmVerified"));
          },
        ).open();
      })
  );
}
