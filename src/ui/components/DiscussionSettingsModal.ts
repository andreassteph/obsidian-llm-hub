import { Modal, App } from "obsidian";
import type { DiscussionSettings } from "src/types";
import { DEFAULT_DISCUSSION_SETTINGS } from "src/types";
import { t } from "src/i18n";

/**
 * Modal for editing Discussion settings (prompts, output folder, default turns).
 */
export class DiscussionSettingsModal extends Modal {
  private settings: DiscussionSettings;
  private onSave: (settings: DiscussionSettings) => void;

  constructor(app: App, settings: DiscussionSettings, onSave: (settings: DiscussionSettings) => void) {
    super(app);
    this.settings = { ...settings };
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("llm-hub-discussion-settings-modal");

    contentEl.createEl("h2", { text: t("discussion.settings") });

    // System prompt
    this.createTextAreaField(
      contentEl,
      t("discussion.systemPrompt"),
      t("discussion.systemPromptDesc"),
      this.settings.systemPrompt,
      DEFAULT_DISCUSSION_SETTINGS.systemPrompt,
      (value) => { this.settings.systemPrompt = value; },
    );

    // Conclusion prompt
    this.createTextAreaField(
      contentEl,
      t("discussion.conclusionPrompt"),
      t("discussion.conclusionPromptDesc"),
      this.settings.conclusionPrompt,
      DEFAULT_DISCUSSION_SETTINGS.conclusionPrompt,
      (value) => { this.settings.conclusionPrompt = value; },
    );

    // Vote prompt
    this.createTextAreaField(
      contentEl,
      t("discussion.votePrompt"),
      t("discussion.votePromptDesc"),
      this.settings.votePrompt,
      DEFAULT_DISCUSSION_SETTINGS.votePrompt,
      (value) => { this.settings.votePrompt = value; },
    );

    // Output folder
    const folderRow = contentEl.createDiv({ cls: "llm-hub-discussion-settings-row" });
    folderRow.createEl("label", { text: t("discussion.outputFolder") });
    const folderDesc = folderRow.createEl("div", { cls: "llm-hub-discussion-settings-desc" });
    folderDesc.setText(t("discussion.outputFolderDesc"));
    const folderInput = folderRow.createEl("input", { type: "text" });
    folderInput.value = this.settings.outputFolder;
    folderInput.placeholder = DEFAULT_DISCUSSION_SETTINGS.outputFolder;
    folderInput.addEventListener("input", () => {
      this.settings.outputFolder = folderInput.value;
    });

    // Default turns
    const turnsRow = contentEl.createDiv({ cls: "llm-hub-discussion-settings-row" });
    turnsRow.createEl("label", { text: t("discussion.defaultTurns") });
    const turnsInput = turnsRow.createEl("input", { type: "number" });
    turnsInput.value = String(this.settings.defaultTurns);
    turnsInput.min = "1";
    turnsInput.max = "10";
    turnsInput.addEventListener("input", () => {
      this.settings.defaultTurns = parseInt(turnsInput.value) || 2;
    });

    // Actions
    const actions = contentEl.createDiv({ cls: "llm-hub-modal-actions" });

    const saveBtn = actions.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    saveBtn.addEventListener("click", () => {
      this.onSave(this.settings);
      this.close();
    });

    const cancelBtn = actions.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  private createTextAreaField(
    container: HTMLElement,
    label: string,
    description: string,
    value: string,
    placeholder: string,
    onChange: (value: string) => void,
  ) {
    const row = container.createDiv({ cls: "llm-hub-discussion-settings-row" });
    row.createEl("label", { text: label });
    const desc = row.createEl("div", { cls: "llm-hub-discussion-settings-desc" });
    desc.setText(description);
    const textarea = row.createEl("textarea", { cls: "llm-hub-discussion-settings-textarea" });
    textarea.value = value;
    textarea.placeholder = placeholder;
    textarea.rows = 4;
    textarea.addEventListener("input", () => {
      onChange(textarea.value);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
