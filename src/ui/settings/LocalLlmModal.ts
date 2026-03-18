import { Modal, App, Setting, Notice } from "obsidian";
import { fetchLocalLlmModels } from "src/core/localLlmProvider";
import { t } from "src/i18n";
import type { LocalLlmConfig, LlmFramework } from "src/types";

export class LocalLlmModal extends Modal {
  private config: LocalLlmConfig;
  private onSave: (config: LocalLlmConfig, models: string[]) => void | Promise<void>;
  private fetchedModels: string[] = [];
  private modelsFetched = false;
  private saveButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    currentConfig: LocalLlmConfig,
    existingModels: string[],
    onSave: (config: LocalLlmConfig, models: string[]) => void | Promise<void>,
  ) {
    super(app);
    this.config = { ...currentConfig };
    this.onSave = onSave;
    if (existingModels.length > 0) {
      this.fetchedModels = [...existingModels];
      this.modelsFetched = true;
    }
  }

  onOpen() {
    this.display();
  }

  private display() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gemini-helper-modal");
    contentEl.createEl("h2", { text: t("settings.localLlmModal.title") });

    const descEl = contentEl.createDiv({ cls: "gemini-helper-modal-desc" });
    descEl.textContent = t("settings.localLlmModal.desc");

    // Framework
    const frameworkDefaults: Record<LlmFramework, string> = {
      ollama: "http://localhost:11434",
      "lm-studio": "http://localhost:1234",
      anythingllm: "http://localhost:3001/api",
      vllm: "http://localhost:8000",
    };

    new Setting(contentEl)
      .setName(t("settings.localLlmModal.framework"))
      .setDesc(t("settings.localLlmModal.frameworkDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("ollama", "Ollama")
          .addOption("lm-studio", "LM Studio (OpenAI compatible)")
          .addOption("anythingllm", "AnythingLLM")
          .addOption("vllm", "vLLM")
          .setValue(this.config.framework)
          .onChange((value) => {
            const fw = value as LlmFramework;
            this.config.framework = fw;
            this.config.baseUrl = frameworkDefaults[fw];
            this.modelsFetched = false;
            this.fetchedModels = [];
            this.display();
          });
      });

    // Base URL
    new Setting(contentEl)
      .setName(t("settings.localLlmModal.baseUrl"))
      .setDesc(t("settings.localLlmModal.baseUrlDesc"))
      .addText((text) => {
        text
          .setPlaceholder(frameworkDefaults[this.config.framework])
          .setValue(this.config.baseUrl)
          .onChange((value) => {
            this.config.baseUrl = value;
            this.modelsFetched = false;
            this.fetchedModels = [];
            this.updateSaveButton();
          });
        text.inputEl.addClass("gemini-helper-wide-input");
      });

    // API Key (optional)
    new Setting(contentEl)
      .setName(t("settings.localLlmModal.apiKey"))
      .setDesc(this.config.framework === "anythingllm"
        ? t("settings.localLlmModal.apiKeyDescAnythingllm")
        : t("settings.localLlmModal.apiKeyDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.localLlmModal.apiKeyPlaceholder"))
          .setValue(this.config.apiKey || "")
          .onChange((value) => {
            this.config.apiKey = value || undefined;
          });
        text.inputEl.type = "password";
      });

    // Fetch models + model selector
    const fetchSetting = new Setting(contentEl)
      .setName(t("settings.localLlmModal.model"))
      .setDesc(t("settings.localLlmModal.modelDesc"));

    const fetchStatusEl = fetchSetting.controlEl.createDiv({ cls: "gemini-helper-cli-row-status" });
    if (this.modelsFetched) {
      fetchStatusEl.addClass("gemini-helper-cli-status--success");
      fetchStatusEl.textContent = t("settings.localLlmModal.modelsLoaded").replace("{{count}}", String(this.fetchedModels.length));
    }

    fetchSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.localLlmModal.fetchModels"))
        .onClick(async () => {
          fetchStatusEl.empty();
          fetchStatusEl.removeClass("gemini-helper-cli-status--success", "gemini-helper-cli-status--error");
          btn.setButtonText(t("settings.localLlmModal.fetching"));
          btn.setDisabled(true);
          try {
            const models = await fetchLocalLlmModels(this.config);
            if (models.length === 0) {
              fetchStatusEl.addClass("gemini-helper-cli-status--error");
              fetchStatusEl.textContent = t("settings.localLlmModal.noModelsFound");
              return;
            }
            this.fetchedModels = models;
            this.modelsFetched = true;
            if (!this.config.model || !models.includes(this.config.model)) {
              this.config.model = models[0];
            }
            this.updateSaveButton();
            this.display();
          } catch (err) {
            fetchStatusEl.addClass("gemini-helper-cli-status--error");
            fetchStatusEl.textContent = err instanceof Error ? err.message : String(err);
          } finally {
            btn.setButtonText(t("settings.localLlmModal.fetchModels"));
            btn.setDisabled(false);
          }
        })
    );

    // Model dropdown (only shown after fetch)
    if (this.modelsFetched && this.fetchedModels.length > 0) {
      new Setting(contentEl)
        .addDropdown((dropdown) => {
          for (const model of this.fetchedModels) {
            dropdown.addOption(model, model);
          }
          dropdown
            .setValue(this.config.model || this.fetchedModels[0])
            .onChange((value) => {
              this.config.model = value;
            });
        });
    }

    // Temperature
    new Setting(contentEl)
      .setName(t("settings.localLlmModal.temperature"))
      .setDesc(t("settings.localLlmModal.temperatureDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.localLlmModal.serverDefault"))
          .setValue(this.config.temperature != null ? String(this.config.temperature) : "")
          .onChange((value) => {
            const trimmed = value.trim();
            this.config.temperature = trimmed ? parseFloat(trimmed) : undefined;
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "2";
        text.inputEl.step = "0.1";
      });

    // Max tokens
    new Setting(contentEl)
      .setName(t("settings.localLlmModal.maxTokens"))
      .setDesc(t("settings.localLlmModal.maxTokensDesc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.localLlmModal.serverDefault"))
          .setValue(this.config.maxTokens != null ? String(this.config.maxTokens) : "")
          .onChange((value) => {
            const trimmed = value.trim();
            this.config.maxTokens = trimmed ? parseInt(trimmed, 10) : undefined;
          });
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.step = "1";
      });

    // Save / Cancel
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("common.cancel")).onClick(() => {
          this.close();
        })
      )
      .addButton((btn) => {
        this.saveButton = btn.buttonEl;
        btn
          .setButtonText(t("common.save"))
          .setCta()
          .onClick(() => {
            if (!this.config.baseUrl.trim()) {
              new Notice(t("settings.localLlmModal.baseUrlRequired"));
              return;
            }
            if (!this.modelsFetched) {
              new Notice(t("settings.localLlmModal.fetchRequired"));
              return;
            }
            void this.onSave(this.config, this.fetchedModels);
            this.close();
          });
        this.updateSaveButton();
      });
  }

  private updateSaveButton() {
    if (this.saveButton) {
      this.saveButton.disabled = !this.modelsFetched;
      this.saveButton.toggleClass("is-disabled", !this.modelsFetched);
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
