import { App, Notice, Platform } from "obsidian";
import type { EventEmitter } from "../utils/EventEmitter";
import {
  type LlmHubSettings,
  type WorkspaceState,
  type RagSetting,
  type ModelType,
  DEFAULT_WORKSPACE_STATE,
  DEFAULT_RAG_SETTING,
  WORKSPACE_FOLDER,
  getDefaultModel,
  isApiProviderModel,
  getApiProviderId,
} from "../types";
import { formatError } from "../utils/error";

const WORKSPACE_STATE_FILENAME = "gemini-workspace.json";
const OLD_WORKSPACE_STATE_FILENAME = ".gemini-workspace.json";

export class WorkspaceStateManager {
  workspaceState: WorkspaceState = { ...DEFAULT_WORKSPACE_STATE };

  constructor(
    private app: App,
    private getSettings: () => LlmHubSettings,
    private saveSettingsCallback: () => Promise<void>,
    private settingsEmitter: EventEmitter,
    private loadDataCallback: () => Promise<unknown>
  ) {}

  private get settings(): LlmHubSettings {
    return this.getSettings();
  }

  // Get the path to the workspace state file
  getWorkspaceStateFilePath(): string {
    return `${WORKSPACE_FOLDER}/${WORKSPACE_STATE_FILENAME}`;
  }

  // Get old workspace state file path (for migration)
  private getOldWorkspaceStateFilePath(): string {
    return `${WORKSPACE_FOLDER}/${OLD_WORKSPACE_STATE_FILENAME}`;
  }

  // Load workspace state from file
  async loadWorkspaceState(): Promise<void> {
    this.workspaceState = { ...DEFAULT_WORKSPACE_STATE };

    const filePath = this.getWorkspaceStateFilePath();

    try {
      let exists = await this.app.vault.adapter.exists(filePath);

      // Migrate from old hidden file name if new file doesn't exist
      if (!exists) {
        const oldFilePath = this.getOldWorkspaceStateFilePath();
        const oldExists = await this.app.vault.adapter.exists(oldFilePath);
        if (oldExists) {
          const content = await this.app.vault.adapter.read(oldFilePath);
          await this.app.vault.adapter.write(filePath, content);
          await this.app.vault.adapter.remove(oldFilePath);
          exists = true;
        }
      }

      if (exists) {
        await this.loadWorkspaceStateFromPath(filePath);
      }
    } catch (error) {
      // Log error for debugging
      console.error("LLM Hub: Failed to load workspace state:", formatError(error));
    }
  }

  private async loadWorkspaceStateFromPath(filePath: string): Promise<void> {
    const content = await this.app.vault.adapter.read(filePath);
    const loaded = JSON.parse(content) as Partial<WorkspaceState>;
    this.workspaceState = { ...DEFAULT_WORKSPACE_STATE, ...loaded };

    // Ensure each RAG setting has all required fields (migration for new fields)
    for (const [settingName, setting] of Object.entries(this.workspaceState.ragSettings)) {
      this.workspaceState.ragSettings[settingName] = {
        ...DEFAULT_RAG_SETTING,
        ...setting,
      };
    }
  }

  // Load workspace state, create file if not exists
  async loadOrCreateWorkspaceState(): Promise<void> {
    await this.loadWorkspaceState();

    const filePath = this.getWorkspaceStateFilePath();
    const exists = await this.app.vault.adapter.exists(filePath);
    if (!exists) {
      await this.saveWorkspaceState();
    }
  }

  // Save workspace state to file
  async saveWorkspaceState(): Promise<void> {
    const filePath = this.getWorkspaceStateFilePath();
    const content = JSON.stringify(this.workspaceState, null, 2);

    // Ensure folder exists
    const folderExists = await this.app.vault.adapter.exists(WORKSPACE_FOLDER);
    if (!folderExists) {
      await this.app.vault.createFolder(WORKSPACE_FOLDER);
    }

    await this.app.vault.adapter.write(filePath, content);
  }

  // Get currently selected RAG setting
  getSelectedRagSetting(): RagSetting | null {
    const name = this.workspaceState.selectedRagSetting;
    if (!name) return null;
    return this.workspaceState.ragSettings[name] || null;
  }

  // Get RAG setting by name
  getRagSetting(name: string): RagSetting | null {
    return this.workspaceState.ragSettings[name] || null;
  }

  // Get all RAG setting names
  getRagSettingNames(): string[] {
    return Object.keys(this.workspaceState.ragSettings);
  }

  // Select a RAG setting
  async selectRagSetting(name: string | null): Promise<void> {
    this.workspaceState.selectedRagSetting = name;
    await this.saveWorkspaceState();
    this.settingsEmitter.emit("rag-setting-changed", name);
  }

  // Select a model
  async selectModel(model: ModelType): Promise<void> {
    this.workspaceState.selectedModel = model;
    await this.saveWorkspaceState();
  }

  // Get selected model
  getSelectedModel(): ModelType {
    const fallback = getDefaultModel(this.settings);
    const selected = this.workspaceState.selectedModel || fallback;

    // CLI models are only allowed on desktop if verified
    const cliConfig = this.settings.cliConfig;
    if (selected === "gemini-cli") {
      if (Platform.isMobile || !cliConfig?.cliVerified) return fallback;
      return selected;
    }
    if (selected === "claude-cli") {
      if (Platform.isMobile || !cliConfig?.claudeCliVerified) return fallback;
      return selected;
    }
    if (selected === "codex-cli") {
      if (Platform.isMobile || !cliConfig?.codexCliVerified) return fallback;
      return selected;
    }
    if (selected === "local-llm") {
      if (Platform.isMobile || !this.settings.localLlmVerified) return fallback;
      return selected;
    }

    // Validate api:* models against provider list
    if (isApiProviderModel(selected)) {
      const providerId = getApiProviderId(selected);
      const provider = this.settings.apiProviders.find(p => p.id === providerId && p.enabled && p.verified);
      return provider ? selected : fallback;
    }

    return fallback;
  }

  // Create a new RAG setting
  async createRagSetting(name: string, setting?: Partial<RagSetting>): Promise<void> {
    if (this.workspaceState.ragSettings[name]) {
      throw new Error(`Semantic search setting "${name}" already exists`);
    }

    this.workspaceState.ragSettings[name] = {
      ...DEFAULT_RAG_SETTING,
      ...setting,
    };

    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }

  // Update a RAG setting
  async updateRagSetting(name: string, updates: Partial<RagSetting>): Promise<void> {
    const existing = this.workspaceState.ragSettings[name];
    if (!existing) {
      throw new Error(`Semantic search setting "${name}" not found`);
    }

    this.workspaceState.ragSettings[name] = {
      ...existing,
      ...updates,
    };

    await this.saveWorkspaceState();
  }

  // Delete a RAG setting
  async deleteRagSetting(name: string): Promise<void> {
    if (!this.workspaceState.ragSettings[name]) {
      return;
    }

    delete this.workspaceState.ragSettings[name];

    // If this was the selected setting, clear selection
    if (this.workspaceState.selectedRagSetting === name) {
      this.workspaceState.selectedRagSetting = null;
    }

    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }

  // Rename a RAG setting
  async renameRagSetting(oldName: string, newName: string): Promise<void> {
    if (!this.workspaceState.ragSettings[oldName]) {
      throw new Error(`Semantic search setting "${oldName}" not found`);
    }
    if (this.workspaceState.ragSettings[newName]) {
      throw new Error(`Semantic search setting "${newName}" already exists`);
    }

    this.workspaceState.ragSettings[newName] = this.workspaceState.ragSettings[oldName];
    delete this.workspaceState.ragSettings[oldName];

    // Update selection if needed
    if (this.workspaceState.selectedRagSetting === oldName) {
      this.workspaceState.selectedRagSetting = newName;
    }

    await this.saveWorkspaceState();
    this.settingsEmitter.emit("workspace-state-loaded", this.workspaceState);
  }

  // Reset sync state for a RAG setting
  async resetRagSettingSyncState(name: string): Promise<void> {
    const setting = this.workspaceState.ragSettings[name];
    if (!setting) {
      throw new Error(`Semantic search setting "${name}" not found`);
    }

    this.workspaceState.ragSettings[name] = {
      ...setting,
      lastFullSync: null,
    };

    await this.saveWorkspaceState();
    new Notice("Sync state has been reset. Next sync will re-embed all files.");
  }

  // Get vault name for store naming
  getVaultStoreName(): string {
    const vaultName = this.app.vault.getName();
    return `obsidian-${vaultName}`;
  }

  // Migrate from old settings format
  async migrateFromOldSettings(): Promise<void> {
    const data = await this.loadDataCallback() as Record<string, unknown> | undefined;
    if (!data) return;

    let needsSave = false;

    // Clean up legacy fields
    if (data.chatsFolder !== undefined) {
      delete data.chatsFolder;
      needsSave = true;
    }
    if (data.workspaceFolder !== undefined) {
      delete data.workspaceFolder;
      needsSave = true;
    }
    if (data.skillsFolderPath !== undefined) {
      delete data.skillsFolderPath;
      needsSave = true;
    }

    if (needsSave) {
      // The caller must handle saving the modified data
      // Since we can't directly save plugin data from here, we emit an event
      this.settingsEmitter.emit("migration-data-modified", data);
    }
  }

}
