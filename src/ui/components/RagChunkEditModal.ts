import { Modal, App } from "obsidian";
import { getLocalRagStore, type LocalRagSearchResult } from "src/core/localRagStore";
import { t } from "src/i18n";

export interface RagChunkEditResult {
  text: string;
}

/**
 * Modal to edit a RAG search result text with adjacent chunk loading.
 * Adjacent chunks are appended/prepended to the textarea as non-overlapping
 * portions, so chunk overlap does not cause duplicate text.
 */
export class RagChunkEditModal extends Modal {
  private result: LocalRagSearchResult;
  private ragSettingName: string;
  private onResult: (result: RagChunkEditResult) => void;
  private textarea: HTMLTextAreaElement | null = null;
  /** The smallest chunkIndex currently loaded (for "load prev" boundary). */
  private minLoadedChunkIndex: number;
  /** The largest chunkIndex currently loaded (for "load next" boundary). */
  private maxLoadedChunkIndex: number;
  /** Whether no more prev chunks exist. */
  private noPrev = false;
  /** Whether no more next chunks exist. */
  private noNext = false;

  constructor(
    app: App,
    result: LocalRagSearchResult,
    ragSettingName: string,
    onResult: (result: RagChunkEditResult) => void,
  ) {
    super(app);
    this.result = result;
    this.ragSettingName = ragSettingName;
    this.onResult = onResult;
    this.minLoadedChunkIndex = result.chunkIndex;
    this.maxLoadedChunkIndex = result.chunkIndex;
    if (result.chunkIndex === 0) this.noPrev = true;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("llm-hub-rag-chunk-edit-modal");

    // Header
    const header = contentEl.createDiv({ cls: "llm-hub-rag-chunk-edit-header" });
    const fileName = this.result.filePath.split("/").pop() || this.result.filePath;
    header.createEl("h3", { text: fileName });
    const pathEl = header.createEl("div", {
      cls: "llm-hub-rag-text-modal-path",
      text: this.result.filePath,
    });
    if (this.result.pageLabel) {
      pathEl.appendText(` (${this.result.pageLabel})`);
    }

    // Prev chunk link container
    this.prevContainer = contentEl.createDiv({ cls: "llm-hub-rag-chunk-nav" });
    this.renderPrevLink();

    // Textarea
    this.textarea = contentEl.createEl("textarea", {
      cls: "llm-hub-rag-chunk-edit-textarea",
    });
    this.textarea.value = this.result.text;

    // Next chunk link container
    this.nextContainer = contentEl.createDiv({ cls: "llm-hub-rag-chunk-nav" });
    this.renderNextLink();

    // Actions
    const actions = contentEl.createDiv({ cls: "llm-hub-modal-actions" });

    const saveBtn = actions.createEl("button", {
      text: t("common.save"),
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      this.onResult({ text: this.textarea?.value ?? "" });
      this.close();
    });

    const cancelBtn = actions.createEl("button", {
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    setTimeout(() => this.textarea?.focus(), 50);
  }

  private prevContainer: HTMLDivElement | null = null;
  private nextContainer: HTMLDivElement | null = null;

  private renderPrevLink() {
    if (!this.prevContainer) return;
    this.prevContainer.empty();
    if (!this.noPrev) {
      const link = this.prevContainer.createEl("a", {
        cls: "llm-hub-rag-chunk-link",
        text: `▲ ${t("search.loadPrevChunk")}`,
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        void this.loadChunk("prev");
      });
    }
  }

  private renderNextLink() {
    if (!this.nextContainer) return;
    this.nextContainer.empty();
    if (!this.noNext) {
      const link = this.nextContainer.createEl("a", {
        cls: "llm-hub-rag-chunk-link",
        text: `▼ ${t("search.loadNextChunk")}`,
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        void this.loadChunk("next");
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  /**
   * Compute the non-overlapping portion of an adjacent chunk.
   * Chunks may share text at their boundaries due to chunkOverlap.
   * We find the longest common suffix/prefix and return only the new part.
   */
  private getNonOverlappingText(
    existingText: string, newChunkText: string, direction: "prev" | "next",
  ): string {
    if (direction === "next") {
      // newChunk starts with overlap from existingText's end
      const maxOverlap = Math.min(existingText.length, newChunkText.length);
      let overlapLen = 0;
      for (let len = maxOverlap; len > 0; len--) {
        const suffix = existingText.slice(-len);
        if (newChunkText.startsWith(suffix)) {
          overlapLen = len;
          break;
        }
      }
      return newChunkText.slice(overlapLen);
    } else {
      // newChunk ends with overlap from existingText's start
      const maxOverlap = Math.min(existingText.length, newChunkText.length);
      let overlapLen = 0;
      for (let len = maxOverlap; len > 0; len--) {
        const prefix = existingText.slice(0, len);
        if (newChunkText.endsWith(prefix)) {
          overlapLen = len;
          break;
        }
      }
      return newChunkText.slice(0, newChunkText.length - overlapLen);
    }
  }

  private async loadChunk(direction: "prev" | "next"): Promise<void> {
    const store = getLocalRagStore();
    if (!store || !this.textarea) return;

    const sourceChunkIndex = direction === "prev"
      ? this.minLoadedChunkIndex
      : this.maxLoadedChunkIndex;

    const adjacent = await store.getAdjacentChunk(
      this.app, this.ragSettingName, this.result.filePath, sourceChunkIndex, direction,
    );

    if (!adjacent) {
      if (direction === "prev") { this.noPrev = true; this.renderPrevLink(); }
      else { this.noNext = true; this.renderNextLink(); }
      return;
    }

    const currentText = this.textarea.value;
    const newPart = this.getNonOverlappingText(currentText, adjacent.text, direction);

    if (!newPart.trim()) {
      // Nothing new to add (fully overlapping)
      if (direction === "prev") {
        this.minLoadedChunkIndex = adjacent.chunkIndex;
        if (adjacent.chunkIndex === 0) { this.noPrev = true; this.renderPrevLink(); }
      } else {
        this.maxLoadedChunkIndex = adjacent.chunkIndex;
      }
      return;
    }

    if (direction === "prev") {
      this.textarea.value = newPart + "\n\n" + currentText;
      this.minLoadedChunkIndex = adjacent.chunkIndex;
      if (adjacent.chunkIndex === 0) { this.noPrev = true; this.renderPrevLink(); }
    } else {
      this.textarea.value = currentText + "\n\n" + newPart;
      this.maxLoadedChunkIndex = adjacent.chunkIndex;
    }

    // Re-check next chunk existence
    const nextCheck = await store.getAdjacentChunk(
      this.app, this.ragSettingName, this.result.filePath, this.maxLoadedChunkIndex, "next",
    );
    if (!nextCheck) { this.noNext = true; this.renderNextLink(); }
  }
}
