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
  private prevContainer: HTMLDivElement | null = null;
  private nextContainer: HTMLDivElement | null = null;
  /** Original text of the first (most-prev) loaded chunk — used to locate position in index. */
  private firstChunkText: string;
  /** Original text of the last (most-next) loaded chunk. */
  private lastChunkText: string;

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
    this.firstChunkText = result.text;
    this.lastChunkText = result.text;
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

    // Prev chunk link container — always show initially
    this.prevContainer = contentEl.createDiv({ cls: "llm-hub-rag-chunk-nav" });
    this.createLink("prev");

    // Textarea
    this.textarea = contentEl.createEl("textarea", {
      cls: "llm-hub-rag-chunk-edit-textarea",
    });
    this.textarea.value = this.result.text;

    // Next chunk link container — always show initially
    this.nextContainer = contentEl.createDiv({ cls: "llm-hub-rag-chunk-nav" });
    this.createLink("next");

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

  onClose() {
    this.contentEl.empty();
  }

  private createLink(direction: "prev" | "next") {
    const container = direction === "prev" ? this.prevContainer : this.nextContainer;
    if (!container) return;
    container.empty();
    const isPrev = direction === "prev";
    const link = container.createEl("a", {
      cls: "llm-hub-rag-chunk-link",
      text: isPrev ? `▲ ${t("search.loadPrevChunk")}` : `▼ ${t("search.loadNextChunk")}`,
    });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      void this.loadChunk(direction);
    });
  }

  private hideLink(direction: "prev" | "next") {
    const container = direction === "prev" ? this.prevContainer : this.nextContainer;
    if (container) container.empty();
  }

  /**
   * Compute the non-overlapping portion of an adjacent chunk.
   */
  private getNonOverlappingText(
    existingText: string, newChunkText: string, direction: "prev" | "next",
  ): string {
    if (direction === "next") {
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

    const chunkText = direction === "prev" ? this.firstChunkText : this.lastChunkText;

    const adjacent = await store.getAdjacentChunk(
      this.app, this.ragSettingName, this.result.filePath, chunkText, direction,
    );

    if (!adjacent) {
      this.hideLink(direction);
      return;
    }

    const currentText = this.textarea.value;
    const newPart = this.getNonOverlappingText(currentText, adjacent.text, direction);

    if (direction === "prev") {
      this.firstChunkText = adjacent.text;
      if (newPart.trim()) {
        this.textarea.value = newPart + "\n\n" + currentText;
      }
      // Check if there's another prev
      const morePrev = await store.getAdjacentChunk(
        this.app, this.ragSettingName, this.result.filePath, adjacent.text, "prev",
      );
      if (!morePrev) this.hideLink("prev");
    } else {
      this.lastChunkText = adjacent.text;
      if (newPart.trim()) {
        this.textarea.value = currentText + "\n\n" + newPart;
      }
      // Check if there's another next
      const moreNext = await store.getAdjacentChunk(
        this.app, this.ragSettingName, this.result.filePath, adjacent.text, "next",
      );
      if (!moreNext) this.hideLink("next");
    }
  }
}
