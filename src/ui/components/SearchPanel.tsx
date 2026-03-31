import { useState, useEffect, useRef, useCallback } from "react";
import Search from "lucide-react/dist/esm/icons/search";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import FileText from "lucide-react/dist/esm/icons/file-text";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Notice } from "obsidian";
import type { LlmHubPlugin } from "src/plugin";
import type { Attachment } from "src/types";
import { getGeminiApiKey, DEFAULT_GEMINI_EMBEDDING_MODEL, DEFAULT_RAG_SETTING } from "src/types";
import { TFile } from "obsidian";
import { getLocalRagStore, extractPdfPages, loadRagMediaAttachments, type LocalRagSearchResult, type RagMediaReference } from "src/core/localRagStore";
import { extensionToMimeType } from "src/core/embeddingProvider";
import { t } from "src/i18n";

interface SearchPanelProps {
  plugin: LlmHubPlugin;
  onChatWithResults: (attachments: Attachment[]) => void;
}

export default function SearchPanel({ plugin, onChatWithResults }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [ragSettingNames, setRagSettingNames] = useState<string[]>(plugin.getRagSettingNames());
  const [selectedRagSetting, setSelectedRagSetting] = useState<string>(
    plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
  );
  const [results, setResults] = useState<LocalRagSearchResult[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [mediaPreviews, setMediaPreviews] = useState<Map<number, string>>(new Map());
  const mediaPreviewsRef = useRef(mediaPreviews);
  mediaPreviewsRef.current = mediaPreviews;
  const [pdfModes, setPdfModes] = useState<Map<number, "text" | "pdf">>(new Map());
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [topK, setTopK] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.topK ?? DEFAULT_RAG_SETTING.topK;
  });
  const [scoreThreshold, setScoreThreshold] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.scoreThreshold ?? DEFAULT_RAG_SETTING.scoreThreshold;
  });

  // RAG settings section state
  const [showRagConfig, setShowRagConfig] = useState(false);
  const [chunkSize, setChunkSize] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.chunkSize ?? DEFAULT_RAG_SETTING.chunkSize;
  });
  const [chunkOverlap, setChunkOverlap] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.chunkOverlap ?? DEFAULT_RAG_SETTING.chunkOverlap;
  });
  const [pdfChunkPages, setPdfChunkPages] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.pdfChunkPages ?? DEFAULT_RAG_SETTING.pdfChunkPages;
  });
  const [targetFolders, setTargetFolders] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.targetFolders?.join(", ") ?? "";
  });
  const [excludePatterns, setExcludePatterns] = useState(() => {
    const setting = plugin.getRagSetting(
      plugin.workspaceState.selectedRagSetting ?? ragSettingNames[0] ?? ""
    );
    return setting?.excludePatterns?.join("\n") ?? "";
  });
  const [ragSyncing, setRagSyncing] = useState(false);
  const [ragSyncProgress, setRagSyncProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const ragSyncCancelRef = useRef(false);
  const [indexedFiles, setIndexedFiles] = useState<{ filePath: string; chunks: number }[]>([]);
  const [showIndexedFiles, setShowIndexedFiles] = useState(false);

  // Check if current setting is internal (not external index)
  const currentRagSetting = plugin.getRagSetting(selectedRagSetting);
  const isInternalRag = currentRagSetting ? !currentRagSetting.externalIndexPath : false;

  // Revoke PDF blob URLs on unmount
  useEffect(() => {
    return () => {
      mediaPreviewsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // Keep the search panel in sync with workspace state and RAG setting changes.
  useEffect(() => {
    const syncRagSettings = () => {
      const names = plugin.getRagSettingNames();
      setRagSettingNames(names);
      setSelectedRagSetting(prev => {
        const workspaceSelection = plugin.workspaceState.selectedRagSetting;
        if (workspaceSelection && names.includes(workspaceSelection)) return workspaceSelection;
        if (prev && names.includes(prev)) return prev;
        return names[0] ?? "";
      });
    };

    syncRagSettings();
    plugin.settingsEmitter.on("workspace-state-loaded", syncRagSettings);
    plugin.settingsEmitter.on("rag-setting-changed", syncRagSettings);

    return () => {
      plugin.settingsEmitter.off("workspace-state-loaded", syncRagSettings);
      plugin.settingsEmitter.off("rag-setting-changed", syncRagSettings);
    };
  }, [plugin]);

  useEffect(() => {
    const setting = plugin.getRagSetting(selectedRagSetting);
    setTopK(setting?.topK ?? DEFAULT_RAG_SETTING.topK);
    setScoreThreshold(setting?.scoreThreshold ?? DEFAULT_RAG_SETTING.scoreThreshold);
    setChunkSize(setting?.chunkSize ?? DEFAULT_RAG_SETTING.chunkSize);
    setChunkOverlap(setting?.chunkOverlap ?? DEFAULT_RAG_SETTING.chunkOverlap);
    setPdfChunkPages(setting?.pdfChunkPages ?? DEFAULT_RAG_SETTING.pdfChunkPages);
    setTargetFolders(setting?.targetFolders?.join(", ") ?? "");
    setExcludePatterns(setting?.excludePatterns?.join("\n") ?? "");
  }, [plugin, selectedRagSetting]);

  // Load defaults from RAG setting when selection changes
  const handleRagSettingChange = (name: string) => {
    setSelectedRagSetting(name);
    const setting = plugin.getRagSetting(name);
    if (setting) {
      setTopK(setting.topK);
      setScoreThreshold(setting.scoreThreshold);
      setChunkSize(setting.chunkSize);
      setChunkOverlap(setting.chunkOverlap);
      setPdfChunkPages(setting.pdfChunkPages ?? DEFAULT_RAG_SETTING.pdfChunkPages);
      setTargetFolders(setting.targetFolders?.join(", ") ?? "");
      setExcludePatterns(setting.excludePatterns?.join("\n") ?? "");
    }
  };

  // Handle RAG config field updates
  const handleChunkSizeChange = useCallback((value: number) => {
    setChunkSize(value);
    if (selectedRagSetting) {
      void plugin.updateRagSetting(selectedRagSetting, { chunkSize: value });
    }
  }, [plugin, selectedRagSetting]);

  const handleChunkOverlapChange = useCallback((value: number) => {
    setChunkOverlap(value);
    if (selectedRagSetting) {
      void plugin.updateRagSetting(selectedRagSetting, { chunkOverlap: value });
    }
  }, [plugin, selectedRagSetting]);

  const handlePdfChunkPagesChange = useCallback((value: number) => {
    setPdfChunkPages(value);
    if (selectedRagSetting) {
      void plugin.updateRagSetting(selectedRagSetting, { pdfChunkPages: value });
    }
  }, [plugin, selectedRagSetting]);

  const handleTargetFoldersChange = useCallback((value: string) => {
    setTargetFolders(value);
    if (selectedRagSetting) {
      const folders = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      void plugin.updateRagSetting(selectedRagSetting, { targetFolders: folders });
    }
  }, [plugin, selectedRagSetting]);

  const handleExcludePatternsChange = useCallback((value: string) => {
    setExcludePatterns(value);
    if (selectedRagSetting) {
      const patterns = value
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      void plugin.updateRagSetting(selectedRagSetting, { excludePatterns: patterns });
    }
  }, [plugin, selectedRagSetting]);

  // Load indexed files list
  const loadIndexedFiles = useCallback(async () => {
    const store = getLocalRagStore();
    if (!store || !selectedRagSetting) {
      setIndexedFiles([]);
      return;
    }
    const files = await store.getIndexedFiles(plugin.app, selectedRagSetting);
    setIndexedFiles(files);
  }, [plugin, selectedRagSetting]);

  // Load indexed files when config section is opened
  useEffect(() => {
    if (showRagConfig) {
      void loadIndexedFiles();
    }
  }, [showRagConfig, loadIndexedFiles]);

  // Handle RAG sync
  const handleRagSync = useCallback(async () => {
    if (ragSyncing) {
      ragSyncCancelRef.current = true;
      return;
    }
    if (!selectedRagSetting) return;

    setRagSyncing(true);
    setRagSyncProgress(null);
    ragSyncCancelRef.current = false;

    try {
      const result = await plugin.syncVaultForLocalRAG(selectedRagSetting, (current, total, fileName) => {
        if (ragSyncCancelRef.current) {
          throw new Error("Cancelled by user");
        }
        setRagSyncProgress({ current, total, fileName });
      });
      if (result) {
        new Notice(
          t("settings.localSyncResult", {
            embedded: String(result.embedded),
            skipped: String(result.skipped),
            removed: String(result.removed),
          })
        );
        // Reload indexed files list after sync
        void loadIndexedFiles();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg !== "Cancelled by user") {
        new Notice(t("settings.syncFailed", { error: msg }));
      } else {
        new Notice(t("settings.syncCancelled"));
      }
    } finally {
      setRagSyncing(false);
      setRagSyncProgress(null);
      ragSyncCancelRef.current = false;
    }
  }, [plugin, selectedRagSetting, ragSyncing, loadIndexedFiles]);

  const handleSearch = async () => {
    if (isSearching) {
      return;
    }
    if (!selectedRagSetting) {
      new Notice(t("search.noRagSetting"));
      return;
    }
    if (!query.trim()) {
      new Notice(t("search.enterQuery"));
      return;
    }

    const ragSetting = plugin.getRagSetting(selectedRagSetting);
    if (!ragSetting) {
      new Notice(t("search.ragSettingNotFound"));
      return;
    }

    const store = getLocalRagStore();
    if (!store) {
      new Notice(t("search.searchFailed"));
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);
    setSelectedIndices(new Set());
    setExpandedIndices(new Set());
    mediaPreviews.forEach(url => URL.revokeObjectURL(url));
    setMediaPreviews(new Map());
    setPdfModes(new Map());

    try {
      const apiKey = ragSetting.embeddingApiKey || getGeminiApiKey(plugin.settings);
      const searchResults = await store.search(
        selectedRagSetting,
        query.trim(),
        apiKey,
        ragSetting.embeddingModel || (ragSetting.embeddingBaseUrl ? "" : DEFAULT_GEMINI_EMBEDDING_MODEL),
        topK,
        ragSetting.embeddingBaseUrl || undefined,
        scoreThreshold
      );
      setResults(searchResults);
    } catch (err) {
      new Notice(t("search.searchFailed") + ": " + (err instanceof Error ? err.message : String(err)));
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const loadMediaPreview = (index: number, result: LocalRagSearchResult) => {
    if (!result.contentType || result.contentType === "text" || mediaPreviews.has(index)) {
      return;
    }

    void (async () => {
      try {
        if (result.contentType === "pdf" && result.pageLabel) {
          // PDF: extract chunk pages
          const att = await extractPdfPages(plugin.app, result.filePath, result.pageLabel);
          if (att) {
            const bytes = Uint8Array.from(atob(att.data), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: "application/pdf" });
            setMediaPreviews(prev => new Map(prev).set(index, URL.createObjectURL(blob)));
          }
        } else {
          // Image, audio, video: load file directly
          const isAbsolute = result.filePath.startsWith("/") || /^[A-Z]:\\/i.test(result.filePath);
          let bytes: Uint8Array;
          let ext: string;
          if (isAbsolute) {
            const fs = (globalThis as { require?: (id: string) => { promises: { readFile: (p: string) => Promise<Buffer> } } }).require?.("fs");
            const nodePath = (globalThis as { require?: (id: string) => { extname: (p: string) => string } }).require?.("path");
            if (!fs || !nodePath) return;
            const buffer = await fs.promises.readFile(result.filePath);
            bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            ext = nodePath.extname(result.filePath).slice(1);
          } else {
            const file = plugin.app.vault.getAbstractFileByPath(result.filePath);
            if (!(file instanceof TFile)) return;
            const buffer = await plugin.app.vault.readBinary(file);
            bytes = new Uint8Array(buffer);
            ext = file.extension;
          }
          const mimeType = extensionToMimeType(ext);
          if (!mimeType) return;
          const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
          setMediaPreviews(prev => new Map(prev).set(index, URL.createObjectURL(blob)));
        }
      } catch {
        // Preview load failed
      }
    })();
  };

  const toggleExpanded = (index: number) => {
    const result = results[index];
    const isExpanding = !expandedIndices.has(index);

    setExpandedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });

    // Load media preview on first expand
    if (isExpanding && result) {
      loadMediaPreview(index, result);
    }
  };

  const toggleSelection = (index: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIndices.size === results.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(results.map((_, i) => i)));
    }
  };

  const handleChatWithSelected = async () => {
    if (selectedIndices.size === 0) {
      new Notice(t("search.selectResults"));
      return;
    }

    const textAttachments: Attachment[] = [];
    const mediaReferences: RagMediaReference[] = [];

    for (const idx of Array.from(selectedIndices).sort((a, b) => a - b)) {
      const result = results[idx];
      if (!result) continue;

      // Non-text content → attach as media file
      // External RAG PDF with real text: respect per-result pdfModes choice
      const hasPdfText = result.contentType === "pdf" && !result.text.startsWith("[Pdf:");
      const pdfMode = hasPdfText ? (pdfModes.get(idx) ?? "text") : "pdf";
      if (result.contentType && result.contentType !== "text" && !(hasPdfText && pdfMode === "text")) {
        mediaReferences.push({
          filePath: result.filePath,
          contentType: result.contentType,
          pageLabel: result.pageLabel,
        });
        continue;
      }

      // Text content (or PDF with extracted text) → attach as editable text
      const content = `[Source: ${result.filePath}] (relevance: ${result.score.toFixed(3)})\n\n${result.text}`;
      const fileName = result.filePath.split("/").pop() || result.filePath;
      const nameWithChunk = result.chunkIndex > 0
        ? `${fileName} (chunk ${result.chunkIndex})`
        : fileName;
      textAttachments.push({
        name: nameWithChunk,
        type: "text",
        mimeType: "text/plain",
        data: btoa(unescape(encodeURIComponent(content))),
        sourcePath: result.filePath,
        pageLabel: result.pageLabel,
      });
    }

    try {
      const mediaAttachments = mediaReferences.length > 0
        ? await loadRagMediaAttachments(plugin.app, mediaReferences)
        : [];
      onChatWithResults([...textAttachments, ...mediaAttachments]);
    } catch (err) {
      new Notice(t("search.searchFailed") + ": " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSearching) void handleSearch();
    }
  };

  const openPluginSettings = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setting = (plugin.app as any).setting;
    setting?.open?.();
    setting?.openTabById?.(plugin.manifest.id);
  };

  if (ragSettingNames.length === 0) {
    return (
      <div className="llm-hub-search-panel">
        <div className="llm-hub-search-empty-state">
          <p>{t("search.noRagSettings")}</p>
          <p className="llm-hub-search-empty-guide">{t("search.noRagSettingsGuide")}</p>
          <button className="mod-cta" onClick={openPluginSettings}>
            {t("search.openSettings")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="llm-hub-search-panel">
      {/* Search input area */}
      <div className="llm-hub-search-input-area">
        <div className="llm-hub-search-rag-selector">
          <select
            value={selectedRagSetting}
            onChange={e => handleRagSettingChange(e.target.value)}
            className="llm-hub-model-select llm-hub-rag-select"
            disabled={isSearching || ragSyncing}
          >
            {ragSettingNames.map(name => (
              <option key={name} value={name}>
                {t("input.rag", { name })}
              </option>
            ))}
          </select>
          <button
            className="llm-hub-rag-icon-btn"
            onClick={() => setShowRagConfig(!showRagConfig)}
            title={t("input.ragSettings")}
            disabled={ragSyncing}
          >
            <Settings2 size={14} />
          </button>
        </div>
        {showRagConfig && (
          <div className="llm-hub-rag-config-section">
            {isInternalRag && (
              <>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragChunkSize")}: {chunkSize}</label>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={50}
                    value={chunkSize}
                    onChange={e => handleChunkSizeChange(Number(e.target.value))}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragChunkOverlap")}: {chunkOverlap}</label>
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={10}
                    value={chunkOverlap}
                    onChange={e => handleChunkOverlapChange(Number(e.target.value))}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragPdfChunkPages")}: {pdfChunkPages}</label>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={pdfChunkPages}
                    onChange={e => handlePdfChunkPagesChange(Number(e.target.value))}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragTargetFolders")}</label>
                  <input
                    type="text"
                    className="llm-hub-rag-config-input"
                    placeholder={t("input.ragTargetFolders.placeholder")}
                    value={targetFolders}
                    onChange={e => handleTargetFoldersChange(e.target.value)}
                  />
                </div>
                <div className="llm-hub-rag-config-row">
                  <label>{t("input.ragExcludedPatterns")}</label>
                  <textarea
                    className="llm-hub-rag-config-textarea"
                    placeholder={t("input.ragExcludedPatterns.placeholder")}
                    value={excludePatterns}
                    rows={3}
                    onChange={e => handleExcludePatternsChange(e.target.value)}
                  />
                </div>
              </>
            )}
            {/* Last sync timestamp */}
            {currentRagSetting?.lastFullSync && (
              <div className="llm-hub-rag-last-sync">
                {t("input.ragLastSync")}: {new Date(currentRagSetting.lastFullSync).toLocaleString()}
              </div>
            )}
            {/* Indexed files accordion */}
            <div className="llm-hub-rag-indexed-files">
              <button
                className="llm-hub-rag-indexed-files-toggle"
                onClick={() => setShowIndexedFiles(!showIndexedFiles)}
              >
                <ChevronDown size={12} className={showIndexedFiles ? "llm-hub-chevron-rotated" : ""} />
                {t("input.ragIndexedFiles", { count: String(indexedFiles.length) })}
              </button>
              {showIndexedFiles && (
                <div className="llm-hub-rag-indexed-files-list">
                  {indexedFiles.length === 0 ? (
                    <div className="llm-hub-rag-indexed-files-empty">{t("input.ragNoIndexedFiles")}</div>
                  ) : (
                    indexedFiles.map(f => (
                      <div key={f.filePath} className="llm-hub-rag-indexed-file-item">
                        <span
                          className="llm-hub-rag-indexed-file-path"
                          onClick={() => {
                            const file = plugin.app.vault.getAbstractFileByPath(f.filePath);
                            if (file) {
                              void plugin.app.workspace.openLinkText(f.filePath, "", false);
                            } else {
                              const { shell } = (globalThis as { require?: (id: string) => { shell: { openPath: (p: string) => void } } }).require?.("electron") ?? {};
                              if (shell) {
                                void shell.openPath(f.filePath);
                              } else {
                                new Notice(f.filePath, 5000);
                              }
                            }
                          }}
                        >
                          {f.filePath}
                        </span>
                        <span className="llm-hub-rag-indexed-file-chunks">
                          {f.chunks} chunks
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {isInternalRag && ragSyncProgress && (
              <div className="llm-hub-rag-sync-progress-bar">
                <progress
                  value={ragSyncProgress.current}
                  max={ragSyncProgress.total}
                />
                <span className="llm-hub-rag-sync-progress-text">
                  {ragSyncProgress.fileName} ({ragSyncProgress.current}/{ragSyncProgress.total})
                </span>
              </div>
            )}
            <div className="llm-hub-rag-config-actions">
              {isInternalRag && (
                <button
                  className={`llm-hub-rag-text-btn ${ragSyncing ? "syncing" : ""}`}
                  onClick={() => { void handleRagSync(); }}
                >
                  {ragSyncing ? (
                    <><Loader2 size={12} className="llm-hub-spinner" /> {t("settings.cancelSync")}</>
                  ) : (
                    <><RefreshCw size={12} /> {t("settings.localSyncBtn")}</>
                  )}
                </button>
              )}
              <button
                className="llm-hub-rag-text-btn"
                onClick={() => setShowRagConfig(false)}
              >
                {t("input.close")}
              </button>
            </div>
          </div>
        )}
        <div className="llm-hub-search-params">
          <label className="llm-hub-search-param-label">
            Top K:
            <input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={e => setTopK(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
              className="llm-hub-search-param-input"
            />
          </label>
          <label className="llm-hub-search-param-label">
            {t("search.scoreThreshold")}:
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={scoreThreshold}
              onChange={e => setScoreThreshold(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
              className="llm-hub-search-param-input"
            />
          </label>
        </div>
        <div className="llm-hub-search-query-row">
          <textarea
            className="llm-hub-search-query-input"
            placeholder={t("search.queryPlaceholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button
            className="llm-hub-search-btn"
            onClick={() => void handleSearch()}
            disabled={isSearching || !selectedRagSetting}
            title={t("search.search")}
          >
            {isSearching ? (
              <Loader2 size={18} className="llm-hub-spinner" />
            ) : (
              <Search size={18} />
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="llm-hub-search-results">
        {hasSearched && results.length === 0 && !isSearching && (
          <div className="llm-hub-search-no-results">{t("search.noResults")}</div>
        )}
        {results.length > 0 && (
          <>
            <div className="llm-hub-search-results-header">
              <label className="llm-hub-search-select-all">
                <input
                  type="checkbox"
                  checked={selectedIndices.size === results.length}
                  onChange={toggleSelectAll}
                />
                {t("search.selectAll")} ({results.length} {t("search.results")})
              </label>
              <button
                className="llm-hub-search-chat-btn"
                onClick={() => void handleChatWithSelected()}
                disabled={selectedIndices.size === 0}
              >
                <MessageSquare size={14} />
                {t("search.chatWithSelected")} ({selectedIndices.size})
              </button>
            </div>
            {results.map((result, index) => (
              <div
                key={`${result.filePath}-${result.chunkIndex}`}
                className={`llm-hub-search-result-item ${selectedIndices.has(index) ? "selected" : ""}`}
                onClick={() => toggleSelection(index)}
              >
                <div className="llm-hub-search-result-header">
                  <input
                    type="checkbox"
                    checked={selectedIndices.has(index)}
                    onChange={() => toggleSelection(index)}
                    onClick={e => e.stopPropagation()}
                  />
                  <FileText size={14} />
                  <span
                    className="llm-hub-search-result-path"
                    onClick={e => {
                      e.stopPropagation();
                      const file = plugin.app.vault.getAbstractFileByPath(result.filePath);
                      if (file) {
                        void plugin.app.workspace.openLinkText(result.filePath, "", false);
                      } else {
                        // External RAG: open with OS default app
                        const { shell } = (globalThis as { require?: (id: string) => { shell: { openPath: (p: string) => void } } }).require?.("electron") ?? {};
                        if (shell) {
                          void shell.openPath(result.filePath);
                        } else {
                          new Notice(result.filePath, 5000);
                        }
                      }
                    }}
                    title={t("message.clickToOpen", { source: result.filePath })}
                  >
                    {result.filePath}
                  </span>
                  <span className="llm-hub-search-result-score">
                    {(result.score * 100).toFixed(1)}%
                  </span>
                  {result.contentType === "pdf" && !result.text.startsWith("[Pdf:") && (
                    <select
                      className="llm-hub-search-pdf-mode"
                      value={pdfModes.get(index) ?? "text"}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        e.stopPropagation();
                        const mode = e.target.value as "text" | "pdf";
                        setPdfModes(prev => new Map(prev).set(index, mode));
                        if (mode === "pdf" && expandedIndices.has(index)) {
                          loadMediaPreview(index, result);
                        }
                      }}
                    >
                      <option value="text">{t("search.pdfMode.text")}</option>
                      <option value="pdf">{t("search.pdfMode.pdf")}</option>
                    </select>
                  )}
                </div>
                {(() => {
                  const ct = result.contentType;
                  const showMediaPreview = ct === "image" || ct === "audio" || ct === "video"
                    || (ct === "pdf" && (pdfModes.get(index) ?? (result.text.startsWith("[Pdf:") ? "pdf" : "text")) === "pdf");
                  return showMediaPreview;
                })() ? (
                  <>
                    {expandedIndices.has(index) ? (
                      <div className="llm-hub-search-media-preview" onClick={e => e.stopPropagation()}>
                        {mediaPreviews.has(index) ? (
                          result.contentType === "pdf" ? (
                            <iframe src={mediaPreviews.get(index)} className="llm-hub-search-pdf-iframe" />
                          ) : result.contentType === "image" ? (
                            <img src={mediaPreviews.get(index)} className="llm-hub-search-image-preview" />
                          ) : result.contentType === "audio" ? (
                            <audio src={mediaPreviews.get(index)} controls className="llm-hub-search-audio-preview" />
                          ) : result.contentType === "video" ? (
                            <video src={mediaPreviews.get(index)} controls className="llm-hub-search-video-preview" />
                          ) : null
                        ) : (
                          <Loader2 size={18} className="llm-hub-spinner" />
                        )}
                      </div>
                    ) : null}
                    <button
                      className="llm-hub-search-result-toggle"
                      onClick={e => { e.stopPropagation(); toggleExpanded(index); }}
                    >
                      <ChevronDown size={14} className={expandedIndices.has(index) ? "llm-hub-chevron-rotated" : ""} />
                    </button>
                  </>
                ) : (
                  <>
                    <div
                      className={`llm-hub-search-result-preview ${expandedIndices.has(index) ? "expanded" : ""}`}
                      onClick={e => { e.stopPropagation(); toggleExpanded(index); }}
                    >
                      {expandedIndices.has(index) ? result.text : (
                        result.text.length > 300 ? result.text.slice(0, 300) + "..." : result.text
                      )}
                    </div>
                    {result.text.length > 300 && (
                      <button
                        className="llm-hub-search-result-toggle"
                        onClick={e => { e.stopPropagation(); toggleExpanded(index); }}
                      >
                        <ChevronDown size={14} className={expandedIndices.has(index) ? "llm-hub-chevron-rotated" : ""} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
