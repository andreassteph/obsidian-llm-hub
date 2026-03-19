import { Setting, Notice } from "obsidian";
import { getLocalRagStore } from "src/core/localRagStore";
import { t } from "src/i18n";
import { DEFAULT_SETTINGS } from "src/types";
import type { RagSetting } from "src/types";
import { ConfirmModal } from "src/ui/components/ConfirmModal";
import { formatError } from "src/utils/error";
import { RagSettingNameModal } from "./RagSettingNameModal";
import type { SettingsContext } from "./settingsContext";

export function displayRagSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  const app = plugin.app;

  new Setting(containerEl).setName(t("settings.rag")).setHeading();

  // RAG enable toggle
  new Setting(containerEl)
    .setName(t("settings.enableRag"))
    .setDesc(t("settings.enableRag.desc"))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.ragEnabled)
        .onChange((value) => {
          void (async () => {
            plugin.settings.ragEnabled = value;
            await plugin.saveSettings();
            display();
          })();
        })
    );

  if (!plugin.settings.ragEnabled) return;

  const ragSettingNames = plugin.getRagSettingNames();
  const selectedName = plugin.workspaceState.selectedRagSetting;

  // Top K setting
  new Setting(containerEl)
    .setName(t("settings.retrievedChunksLimit"))
    .setDesc(t("settings.retrievedChunksLimit.desc"))
    .addSlider((slider) =>
      slider
        .setLimits(1, 20, 1)
        .setValue(plugin.settings.ragTopK)
        .setDynamicTooltip()
        .onChange((value) => {
          void (async () => {
            plugin.settings.ragTopK = value;
            await plugin.saveSettings();
          })();
        })
    )
    .addExtraButton((button) =>
      button
        .setIcon("reset")
        .setTooltip(t("settings.resetToDefault", { value: String(DEFAULT_SETTINGS.ragTopK) }))
        .onClick(() => {
          void (async () => {
            plugin.settings.ragTopK = DEFAULT_SETTINGS.ragTopK;
            await plugin.saveSettings();
            display();
          })();
        })
    );

  // RAG setting selection
  const ragSelectSetting = new Setting(containerEl)
    .setName(t("settings.ragSetting"))
    .setDesc(t("settings.ragSetting.desc"));

  ragSelectSetting.addDropdown((dropdown) => {
    ragSettingNames.forEach((name) => {
      dropdown.addOption(name, name);
    });

    dropdown.setValue(selectedName || "").onChange((value) => {
      void (async () => {
        await plugin.selectRagSetting(value || null);
        display();
      })();
    });
  });

  // Add new RAG setting button
  ragSelectSetting.addExtraButton((btn) => {
    btn
      .setIcon("plus")
      .setTooltip(t("settings.createRagSetting"))
      .onClick(() => {
        new RagSettingNameModal(
          app,
          t("settings.createRagSetting"),
          "",
          async (name) => {
            try {
              await plugin.createRagSetting(name);
              await plugin.selectRagSetting(name);
              display();
              new Notice(t("settings.ragSettingCreated", { name }));
            } catch (error) {
              new Notice(t("error.failedToCreate", { error: formatError(error) }));
            }
          }
        ).open();
      });
  });

  // Show selected RAG setting details
  if (selectedName) {
    const ragSetting = plugin.getRagSetting(selectedName);
    if (ragSetting) {
      displaySelectedRagSetting(containerEl, ctx, selectedName, ragSetting);
    }
  }
}

function displaySelectedRagSetting(
  containerEl: HTMLElement,
  ctx: SettingsContext,
  name: string,
  ragSetting: RagSetting
): void {
  const { plugin, display } = ctx;
  const app = plugin.app;

  // Setting header with rename/delete buttons
  const headerSetting = new Setting(containerEl)
    .setName(t("settings.settingsFor", { name }))
    .setDesc(t("settings.configureThisSetting"));

  headerSetting.addExtraButton((btn) => {
    btn
      .setIcon("pencil")
      .setTooltip(t("settings.renameSetting"))
      .onClick(() => {
        new RagSettingNameModal(
          app,
          t("settings.renameRagSetting"),
          name,
          async (newName) => {
            try {
              await plugin.renameRagSetting(name, newName);
              display();
              new Notice(t("settings.renamedTo", { name: newName }));
            } catch (error) {
              new Notice(t("error.failedToRename", { error: formatError(error) }));
            }
          }
        ).open();
      });
  });

  headerSetting.addExtraButton((btn) => {
    btn
      .setIcon("trash")
      .setTooltip(t("settings.deleteSetting"))
      .onClick(() => {
        void (async () => {
          const confirmed = await new ConfirmModal(
            app,
            t("settings.deleteSettingConfirm", { name }),
            t("common.delete"),
            t("common.cancel")
          ).openAndWait();
          if (!confirmed) return;

          try {
            await plugin.deleteRagSetting(name);
            display();
            new Notice(t("settings.ragSettingDeleted", { name }));
          } catch (error) {
            new Notice(t("error.failedToDelete", { error: formatError(error) }));
          }
        })();
      });
  });

  // All RAG is now local - go directly to local store settings
  displayLocalStoreSettings(containerEl, ctx, name, ragSetting);
}

function displayLocalStoreSettings(
  containerEl: HTMLElement,
  ctx: SettingsContext,
  name: string,
  ragSetting: RagSetting
): void {
  const { plugin, display, syncCancelRef } = ctx;
  const app = plugin.app;

  // API key warning (only if no custom embedding API key AND no Google API key)
  if (!plugin.settings.localRagEmbeddingApiKey && !plugin.settings.googleApiKey) {
    new Setting(containerEl)
      .setName(t("settings.localApiKeyRequired"))
      .setDesc("")
      .then((s) => s.settingEl.addClass("mod-warning"));
  }

  // Description
  new Setting(containerEl)
    .setDesc(t("settings.storeModeLocal.desc"));

  // Custom Embedding Base URL
  new Setting(containerEl)
    .setName(t("settings.localEmbeddingBaseUrl"))
    .setDesc(t("settings.localEmbeddingBaseUrl.desc"))
    .addText((text) =>
      text
        .setPlaceholder(t("settings.localEmbeddingBaseUrl.placeholder"))
        .setValue(plugin.settings.localRagEmbeddingBaseUrl)
        .onChange((value) => {
          void (async () => {
            plugin.settings.localRagEmbeddingBaseUrl = value.trim();
            await plugin.saveSettings();
          })();
        })
    );

  // Custom Embedding API Key
  new Setting(containerEl)
    .setName(t("settings.localEmbeddingApiKey"))
    .setDesc(t("settings.localEmbeddingApiKey.desc"))
    .addText((text) => {
      text
        .setPlaceholder(t("settings.localEmbeddingApiKey.placeholder"))
        .setValue(plugin.settings.localRagEmbeddingApiKey)
        .onChange((value) => {
          void (async () => {
            plugin.settings.localRagEmbeddingApiKey = value.trim();
            await plugin.saveSettings();
          })();
        });
      text.inputEl.type = "password";
    });

  // Embedding model
  new Setting(containerEl)
    .setName(t("settings.localEmbeddingModel"))
    .setDesc(t("settings.localEmbeddingModel.desc"))
    .addText((text) =>
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setPlaceholder("gemini-embedding-001")
        .setValue(plugin.settings.localRagEmbeddingModel)
        .onChange((value) => {
          void (async () => {
            plugin.settings.localRagEmbeddingModel = value.trim() || "gemini-embedding-001";
            await plugin.saveSettings();
          })();
        })
    );

  // Chunk size
  new Setting(containerEl)
    .setName(t("settings.localChunkSize"))
    .setDesc(t("settings.localChunkSize.desc"))
    .addSlider((slider) =>
      slider
        .setLimits(100, 2000, 50)
        .setValue(plugin.settings.localRagChunkSize)
        .setDynamicTooltip()
        .onChange((value) => {
          void (async () => {
            plugin.settings.localRagChunkSize = value;
            await plugin.saveSettings();
          })();
        })
    );

  // Chunk overlap
  new Setting(containerEl)
    .setName(t("settings.localChunkOverlap"))
    .setDesc(t("settings.localChunkOverlap.desc"))
    .addSlider((slider) =>
      slider
        .setLimits(0, 500, 10)
        .setValue(plugin.settings.localRagChunkOverlap)
        .setDynamicTooltip()
        .onChange((value) => {
          void (async () => {
            plugin.settings.localRagChunkOverlap = value;
            await plugin.saveSettings();
          })();
        })
    );

  // Target Folders
  new Setting(containerEl)
    .setName(t("settings.targetFolders"))
    .setDesc(t("settings.targetFolders.desc"))
    .addText((text) =>
      text
        .setPlaceholder(t("settings.targetFolders.placeholder"))
        .setValue(ragSetting.targetFolders.join(", "))
        .onChange((value) => {
          void (async () => {
            const folders = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await plugin.updateRagSetting(name, { targetFolders: folders });
          })();
        })
    );

  // Excluded Patterns
  const excludePatternsSetting = new Setting(containerEl)
    .setName(t("settings.excludedPatterns"))
    .setDesc(t("settings.excludedPatterns.desc"));

  excludePatternsSetting.settingEl.addClass("gemini-helper-settings-textarea-container");

  excludePatternsSetting.addTextArea((text) => {
    text
      .setPlaceholder(t("settings.excludedPatterns.placeholder"))
      .setValue(ragSetting.excludePatterns.join("\n"))
      .onChange((value) => {
        void (async () => {
          const patterns = value
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          await plugin.updateRagSetting(name, { excludePatterns: patterns });
        })();
      });
    text.inputEl.rows = 4;
    text.inputEl.addClass("gemini-helper-settings-textarea");
  });

  // Sync Status
  const localRag = getLocalRagStore();
  const lastSync = ragSetting.lastFullSync
    ? new Date(ragSetting.lastFullSync).toLocaleString()
    : t("settings.syncStatusNever");

  const syncStatusSetting = new Setting(containerEl)
    .setName(t("settings.localSyncBtn"))
    .setDesc(t("settings.localSyncStatus", { chunks: "0", files: "0" }) + ` (${lastSync})`);

  if (localRag) {
    void (async () => {
      const status = await localRag.getStatus(app, name);
      syncStatusSetting.setDesc(
        t("settings.localSyncStatus", {
          chunks: String(status.chunkCount),
          files: String(status.fileCount),
        }) + ` (${lastSync})`
      );
    })();
  }

  // Progress container
  const progressContainer = containerEl.createDiv({
    cls: "gemini-helper-sync-progress",
  });
  progressContainer.addClass("gemini-helper-hidden");

  const progressText = progressContainer.createDiv();
  const progressBar = progressContainer.createEl("progress");
  progressBar.addClass("gemini-helper-progress-bar");

  let cancelBtn: HTMLButtonElement | null = null;

  syncStatusSetting
    .addButton((btn) => {
      cancelBtn = btn.buttonEl;
      btn
        .setButtonText(t("settings.cancelSync"))
        .setWarning()
        .onClick(() => {
          syncCancelRef.value = true;
          new Notice(t("settings.cancellingSync"));
        });
      btn.buttonEl.addClass("gemini-helper-hidden");
    })
    .addButton((btn) =>
      btn
        .setButtonText(t("settings.localSyncBtn"))
        .setCta()
        .setDisabled(!plugin.settings.localRagEmbeddingApiKey && !plugin.settings.googleApiKey)
        .onClick(() => {
          void (async () => {
            syncCancelRef.value = false;
            btn.setDisabled(true);
            btn.setButtonText(t("settings.localSyncing"));
            if (cancelBtn) cancelBtn.removeClass("gemini-helper-hidden");
            progressContainer.removeClass("gemini-helper-hidden");
            progressText.removeClass("gemini-helper-progress-error");
            progressText.textContent = t("settings.syncPreparing");
            progressBar.value = 0;
            progressBar.max = 100;

            try {
              const result = await plugin.syncVaultForLocalRAG(
                name,
                (current, total, fileName, action) => {
                  if (syncCancelRef.value) {
                    throw new Error("Cancelled by user");
                  }
                  const percent = Math.round((current / total) * 100);
                  progressBar.value = percent;
                  progressBar.max = 100;

                  const actionText =
                    action === "embed"
                      ? t("settings.localSyncEmbedding")
                      : action === "skip"
                        ? t("settings.localSyncSkipping")
                        : t("settings.localSyncRemoving");
                  progressText.textContent = `${actionText}: ${fileName} (${current}/${total})`;
                }
              );
              if (result) {
                new Notice(
                  t("settings.localSyncResult", {
                    embedded: String(result.embedded),
                    skipped: String(result.skipped),
                    removed: String(result.removed),
                  })
                );
              }
            } catch (error) {
              const msg = formatError(error);
              if (msg === "Cancelled by user") {
                new Notice(t("settings.syncCancelled"));
                progressText.textContent = t("settings.syncCancelled");
              } else {
                new Notice(t("settings.syncFailed", { error: msg }));
                progressText.textContent = `${t("common.error")}${msg}`;
                progressText.addClass("gemini-helper-progress-error");
              }
            } finally {
              btn.setDisabled(false);
              btn.setButtonText(t("settings.localSyncBtn"));
              if (cancelBtn) cancelBtn.addClass("gemini-helper-hidden");
              syncCancelRef.value = false;
              setTimeout(() => {
                progressContainer.addClass("gemini-helper-hidden");
                display();
              }, 2000);
            }
          })();
        })
    );

  // Clear index
  new Setting(containerEl)
    .setName(t("settings.localClearIndex"))
    .setDesc(t("settings.localClearIndex.desc"))
    .addButton((btn) =>
      btn
        .setButtonText(t("settings.localClearIndex"))
        .setWarning()
        .onClick(() => {
          void (async () => {
            const confirmed = await new ConfirmModal(
              app,
              t("settings.localClearConfirm"),
              t("common.delete"),
              t("common.cancel")
            ).openAndWait();
            if (!confirmed) return;

            try {
              await plugin.clearLocalRagIndex(name);
              new Notice(t("settings.localIndexCleared"));
              display();
            } catch (error) {
              new Notice(formatError(error));
            }
          })();
        })
    );
}
