import { type App, TFile } from "obsidian";
import {
  generateEmbeddings,
  generateGeminiNativeEmbeddings,
  extensionToMimeType,
  extensionToContentType,
  MULTIMODAL_EXTENSIONS,
  MULTIMODAL_FILE_SIZE_LIMITS,
} from "./embeddingProvider";
import {
  type LocalRagIndex,
  type LocalRagChunkMeta,
  type RagContentType,
  loadRagIndex,
  saveRagIndex,
  loadRagVectors,
  saveRagVectors,
  deleteRagIndex,
  createEmptyIndex,
  loadExternalRagIndex,
  loadExternalRagVectors,
} from "./localRagStorage";
import { DEFAULT_GEMINI_EMBEDDING_MODEL, DEFAULT_RAG_SETTING } from "../types";
export interface FilterConfig {
  includeFolders: string[];
  excludePatterns: string[];
}

function shouldIncludeFile(filePath: string, config: FilterConfig): boolean {
  // Check include folders (if empty, include all)
  if (config.includeFolders.length > 0) {
    let isInIncludedFolder = false;
    for (const folder of config.includeFolders) {
      const normalizedFolder = folder.replace(/\/$/, "");
      if (
        filePath.startsWith(normalizedFolder + "/") ||
        filePath === normalizedFolder
      ) {
        isInIncludedFolder = true;
        break;
      }
    }
    if (!isInIncludedFolder) {
      return false;
    }
  }

  // Check regex pattern exclusions
  for (const pattern of config.excludePatterns) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(filePath)) {
        return false;
      }
    } catch {
      // Invalid regex pattern, skip
    }
  }

  return true;
}

export interface LocalRagSearchResult {
  filePath: string;
  text: string;
  score: number;
  chunkIndex: number;
  contentType?: RagContentType;
}

export interface LocalRagStatus {
  chunkCount: number;
  fileCount: number;
  dimension: number;
  embeddingModel: string;
}

// Convert ArrayBuffer to base64 (chunk-based to avoid O(n^2) string concatenation)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

// Checksum for binary files using stat info
function binaryChecksum(mtime: number, size: number): string {
  return `${mtime}:${size}`;
}

class LocalRagStore {
  private app: App | null = null;
  private entries = new Map<string, { index: LocalRagIndex | null; vectors: Float32Array | null }>();
  private externalPaths = new Map<string, string>();

  async load(app: App, settingNames: string[], ragSettings?: Record<string, import("src/types").RagSetting>): Promise<void> {
    this.app = app;
    if (ragSettings) {
      for (const [name, setting] of Object.entries(ragSettings)) {
        if (setting.externalIndexPath) {
          this.externalPaths.set(name, setting.externalIndexPath);
        }
      }
    }
    for (const settingName of settingNames) {
      await this.ensureLoaded(app, settingName);
    }
  }

  setExternalPath(settingName: string, externalPath: string): void {
    if (externalPath) {
      this.externalPaths.set(settingName, externalPath);
    } else {
      this.externalPaths.delete(settingName);
    }
    // Invalidate cache so next access reloads from the new source
    this.entries.delete(settingName);
  }

  async sync(
    app: App,
    settingName: string,
    apiKey: string,
    model: string,
    chunkSize: number,
    chunkOverlap: number,
    filterConfig: FilterConfig,
    onProgress?: (current: number, total: number, fileName: string, action: "embed" | "skip" | "remove") => void,
    embeddingBaseUrl?: string,
    indexMultimodal = false
  ): Promise<{ embedded: number; skipped: number; removed: number; errors: string[] }> {
    this.app = app;
    const result = { embedded: 0, skipped: 0, removed: 0, errors: [] as string[] };
    const entry = await this.ensureLoaded(app, settingName);
    let index = entry.index;
    let vectors = entry.vectors;

    // Gemini native mode = no custom baseUrl (uses SDK directly)
    const isGeminiNative = !embeddingBaseUrl;

    // Check if we need full rebuild (model, chunk params, or multimodal setting changed)
    const needsFullRebuild = index !== null && (
      index.embeddingModel !== model ||
      index.chunkSize !== chunkSize ||
      index.chunkOverlap !== chunkOverlap ||
      (index.indexMultimodal ?? false) !== indexMultimodal
    );

    if (needsFullRebuild) {
      index = null;
      vectors = null;
    }

    if (!index) {
      index = createEmptyIndex();
    }

    // Determine eligible file extensions
    const isEligibleFile = (f: TFile) => {
      if (f.extension === "md") return true;
      if (indexMultimodal && isGeminiNative && MULTIMODAL_EXTENSIONS.has(f.extension)) return true;
      return false;
    };

    // Get all eligible files
    const allFiles = app.vault.getFiles().filter(
      (f: TFile) => isEligibleFile(f) && shouldIncludeFile(f.path, filterConfig)
    );

    // Calculate checksums for current files
    const currentChecksums: Record<string, string> = {};
    const contentCache = new Map<string, string>();
    for (const file of allFiles) {
      if (file.extension === "md") {
        const content = await app.vault.read(file);
        currentChecksums[file.path] = simpleChecksum(content);
        contentCache.set(file.path, content);
      } else {
        // Binary files: use stat-based checksum
        const stat = await app.vault.adapter.stat(file.path);
        if (stat) {
          currentChecksums[file.path] = binaryChecksum(stat.mtime, stat.size);
        }
      }
    }

    // Determine which files need updating
    const filesToEmbed: TFile[] = [];
    const filesToKeepSet = new Set<string>();
    const currentFilePaths = new Set(allFiles.map(f => f.path));

    for (const file of allFiles) {
      const existingChecksum = index.fileChecksums[file.path];
      if (existingChecksum && existingChecksum === currentChecksums[file.path]) {
        filesToKeepSet.add(file.path);
      } else {
        filesToEmbed.push(file);
      }
    }

    // Remove chunks from deleted/changed files
    const filesToEmbedPaths = new Set(filesToEmbed.map(f => f.path));
    const filesToRemove = Object.keys(index.fileChecksums).filter(
      p => !currentFilePaths.has(p) || filesToEmbedPaths.has(p)
    );

    // Build new index from kept files
    const keptMeta: LocalRagChunkMeta[] = [];
    const keptVectorParts: Float32Array[] = [];

    if (vectors && index.dimension > 0) {
      for (let origIdx = 0; origIdx < index.meta.length; origIdx++) {
        const meta = index.meta[origIdx];
        if (filesToKeepSet.has(meta.filePath)) {
          const origStart = origIdx * index.dimension;
          const origEnd = origStart + index.dimension;
          if (origEnd <= vectors.length) {
            keptVectorParts.push(vectors.slice(origStart, origEnd));
            keptMeta.push(meta);
          }
        }
      }
    }

    result.removed = filesToRemove.length;
    result.skipped = filesToKeepSet.size;

    const totalOps = filesToEmbed.length + filesToRemove.length + filesToKeepSet.size;

    // Report skipped/removed files
    const keptPaths = [...filesToKeepSet];
    for (let i = 0; i < keptPaths.length; i++) {
      onProgress?.(i + 1, totalOps, keptPaths[i], "skip");
    }
    for (let i = 0; i < filesToRemove.length; i++) {
      onProgress?.(filesToKeepSet.size + i + 1, totalOps, filesToRemove[i], "remove");
    }

    // Embed new/changed files
    const newMeta: LocalRagChunkMeta[] = [];
    const newVectorParts: Float32Array[] = [];
    const embeddedChecksums: Record<string, string> = {};
    let dimension = index.dimension;
    let currentOp = filesToKeepSet.size + filesToRemove.length;

    for (const file of filesToEmbed) {
      currentOp++;
      onProgress?.(currentOp, totalOps, file.path, "embed");

      try {
        if (file.extension === "md") {
          // Text file: chunk and embed
          const content = contentCache.get(file.path);
          if (!content) continue;
          const chunks = chunkText(content, chunkSize, chunkOverlap);
          if (chunks.length === 0) continue;

          let embeddings: number[][];
          if (isGeminiNative) {
            embeddings = await generateGeminiNativeEmbeddings(
              chunks.map(text => ({ text })),
              apiKey, model
            );
          } else {
            embeddings = await generateEmbeddings(chunks, apiKey, model, embeddingBaseUrl);
          }

          if (embeddings.length > 0 && embeddings[0].length > 0) {
            dimension = embeddings[0].length;
          }

          for (let i = 0; i < chunks.length; i++) {
            if (embeddings[i] && embeddings[i].length > 0) {
              newMeta.push({ filePath: file.path, chunkIndex: i, text: chunks[i], contentType: "text" });
              newVectorParts.push(new Float32Array(embeddings[i]));
            }
          }
          result.embedded++;
          embeddedChecksums[file.path] = currentChecksums[file.path];
        } else {
          // Multimodal file: embed as single chunk
          const sizeLimit = MULTIMODAL_FILE_SIZE_LIMITS[file.extension];
          const stat = await app.vault.adapter.stat(file.path);
          if (!stat || (sizeLimit && stat.size > sizeLimit)) {
            result.errors.push(`${file.path}: file too large (${stat?.size ?? 0} bytes, limit ${sizeLimit ?? 0})`);
            continue;
          }

          const mimeType = extensionToMimeType(file.extension);
          if (!mimeType) continue;

          const buffer = await app.vault.readBinary(file);
          const base64 = arrayBufferToBase64(buffer);
          const contentType = extensionToContentType(file.extension);

          const embeddings = await generateGeminiNativeEmbeddings(
            [{ inlineData: { mimeType, data: base64 } }],
            apiKey, model
          );

          if (embeddings.length > 0 && embeddings[0].length > 0) {
            dimension = embeddings[0].length;
            const label = `[${contentType.charAt(0).toUpperCase() + contentType.slice(1)}: ${file.name}]`;
            newMeta.push({ filePath: file.path, chunkIndex: 0, text: label, contentType });
            newVectorParts.push(new Float32Array(embeddings[0]));
            result.embedded++;
            embeddedChecksums[file.path] = currentChecksums[file.path];
          }
        }
      } catch (error) {
        result.errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Merge kept + new
    const allMeta = [...keptMeta, ...newMeta];
    const allVectorParts = [...keptVectorParts, ...newVectorParts];

    // Build combined vectors
    const totalElements = allVectorParts.reduce((sum, v) => sum + v.length, 0);
    const combinedVectors = new Float32Array(totalElements);
    let offset = 0;
    for (const part of allVectorParts) {
      combinedVectors.set(part, offset);
      offset += part.length;
    }

    // Update checksums
    const newChecksums: Record<string, string> = {};
    for (const path of filesToKeepSet) {
      newChecksums[path] = index.fileChecksums[path];
    }
    for (const [path, checksum] of Object.entries(embeddedChecksums)) {
      newChecksums[path] = checksum;
    }

    // Save
    index = {
      meta: allMeta,
      dimension,
      fileChecksums: newChecksums,
      embeddingModel: model,
      chunkSize,
      chunkOverlap,
      indexMultimodal,
    };
    vectors = combinedVectors;
    this.entries.set(settingName, { index, vectors });

    await saveRagIndex(app, settingName, index);
    await saveRagVectors(app, settingName, vectors);

    return result;
  }

  async search(
    settingName: string,
    query: string,
    apiKey: string,
    model: string,
    topK: number,
    embeddingBaseUrl?: string,
    scoreThreshold?: number
  ): Promise<LocalRagSearchResult[]> {
    if (!this.app) {
      return [];
    }

    const entry = await this.ensureLoaded(this.app, settingName);
    const { index, vectors } = entry;
    if (!index || !vectors || index.meta.length === 0) {
      return [];
    }

    // For external index, use the model stored in the index itself
    const isExternal = this.externalPaths.has(settingName);
    const effectiveModel = isExternal
      ? (index.embeddingModel || (embeddingBaseUrl ? model : DEFAULT_GEMINI_EMBEDDING_MODEL))
      : model;

    // Use Gemini native for query embedding when no custom baseUrl
    let queryEmbedding: number[];
    if (!embeddingBaseUrl) {
      const results = await generateGeminiNativeEmbeddings([{ text: query }], apiKey, effectiveModel);
      queryEmbedding = results[0];
    } else {
      const results = await generateEmbeddings([query], apiKey, effectiveModel, embeddingBaseUrl);
      queryEmbedding = results[0];
    }
    if (!queryEmbedding) return [];

    const dim = index.dimension;
    const scores: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < index.meta.length; i++) {
      const start = i * dim;
      const end = start + dim;
      if (end > vectors.length) break;

      const docVec = vectors.subarray(start, end);
      const score = cosineSimilarity(queryEmbedding, docVec);
      scores.push({ index: i, score });
    }

    scores.sort((a, b) => b.score - a.score);
    const topResults = scores.slice(0, topK);

    return topResults
      .filter(r => r.score > (scoreThreshold ?? 0))
      .map(r => ({
        filePath: index.meta[r.index].filePath,
        text: index.meta[r.index].text,
        score: r.score,
        chunkIndex: index.meta[r.index].chunkIndex,
        contentType: index.meta[r.index].contentType,
      }));
  }

  async clear(app: App, settingName: string): Promise<void> {
    this.app = app;
    this.entries.delete(settingName);
    await deleteRagIndex(app, settingName);
  }

  async getStatus(app: App, settingName: string): Promise<LocalRagStatus> {
    const entry = await this.ensureLoaded(app, settingName);
    if (!entry.index) {
      return { chunkCount: 0, fileCount: 0, dimension: 0, embeddingModel: "" };
    }
    return {
      chunkCount: entry.index.meta.length,
      fileCount: entry.index.fileChecksums ? Object.keys(entry.index.fileChecksums).length : 0,
      dimension: entry.index.dimension,
      embeddingModel: entry.index.embeddingModel || "",
    };
  }

  private async ensureLoaded(
    app: App,
    settingName: string
  ): Promise<{ index: LocalRagIndex | null; vectors: Float32Array | null }> {
    const existing = this.entries.get(settingName);
    if (existing) {
      return existing;
    }

    const externalPath = this.externalPaths.get(settingName);
    let index: LocalRagIndex | null;
    let vectors: Float32Array | null;
    if (externalPath) {
      index = await loadExternalRagIndex(externalPath);
      vectors = index && index.meta.length > 0
        ? await loadExternalRagVectors(externalPath)
        : null;
    } else {
      index = await loadRagIndex(app, settingName);
      vectors = index && index.meta.length > 0
        ? await loadRagVectors(app, settingName)
        : null;
    }
    const entry = { index, vectors };
    this.entries.set(settingName, entry);
    return entry;
  }
}

export function buildLocalRagContext(results: LocalRagSearchResult[]): string {
  if (results.length === 0) return "";

  let context = "\n\n--- Relevant context from vault (semantic search) ---\n";
  for (const r of results) {
    const ct = r.contentType ?? "text";
    if (ct === "text") {
      context += `\n[Source: ${r.filePath}] (relevance: ${r.score.toFixed(3)})\n${r.text}\n`;
    } else {
      const typeLabel = ct.charAt(0).toUpperCase() + ct.slice(1);
      context += `\n[Source: ${r.filePath}] (relevance: ${r.score.toFixed(3)}) [${typeLabel} file]\n`;
    }
  }
  context += "\n--- End of context ---\n";
  return context;
}

// Chunking: split text into chunks with overlap at paragraph/sentence boundaries
function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (!text.trim()) return [];

  // Clamp overlap to be less than chunk size to ensure forward progress
  const effectiveOverlap = Math.min(chunkOverlap, chunkSize - 1);

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at paragraph boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + chunkSize * 0.5) {
        end = paragraphBreak + 2;
      } else {
        // Try sentence boundary
        const sentenceBreak = text.lastIndexOf(". ", end);
        if (sentenceBreak > start + chunkSize * 0.5) {
          end = sentenceBreak + 2;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    const nextStart = end - effectiveOverlap;
    if (nextStart <= start) {
      start = end;
    } else {
      start = nextStart;
    }
  }

  return chunks;
}

// Simple string checksum using hash
function simpleChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

// Cosine similarity between a number array and a Float32Array subarray
function cosineSimilarity(a: number[], b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

/** Multimodal file reference from RAG search (to be loaded by caller and passed to LLM) */
export interface RagMediaReference {
  filePath: string;
  contentType: RagContentType;
}

export interface LocalRagResult {
  context: string;
  sources: string[];
  /** Non-text files that should be attached to the LLM call for content-based answering */
  mediaReferences: RagMediaReference[];
}

export async function searchLocalRag(
  settingName: string,
  query: string,
  ragSetting: import("src/types").RagSetting,
  fallbackApiKey: string
): Promise<LocalRagResult> {
  const store = getLocalRagStore();
  const apiKey = ragSetting.embeddingApiKey || fallbackApiKey;
  if (!store || !apiKey) {
    return { context: "", sources: [], mediaReferences: [] };
  }
  const results = await store.search(
    settingName, query, apiKey,
    ragSetting.embeddingModel || (ragSetting.embeddingBaseUrl ? "" : DEFAULT_GEMINI_EMBEDDING_MODEL), ragSetting.topK,
    ragSetting.embeddingBaseUrl || undefined,
    ragSetting.scoreThreshold ?? DEFAULT_RAG_SETTING.scoreThreshold
  );
  if (results.length === 0) {
    return { context: "", sources: [], mediaReferences: [] };
  }

  // Collect non-text file references for multimodal attachment
  const mediaReferences: RagMediaReference[] = results
    .filter(r => r.contentType && r.contentType !== "text")
    .map(r => ({ filePath: r.filePath, contentType: r.contentType! }));

  return {
    context: buildLocalRagContext(results),
    sources: [...new Set(results.map(r => r.filePath))],
    mediaReferences,
  };
}

/**
 * Load RAG media references from vault and convert to Attachment objects.
 * Used by Chat.tsx and workflow command.ts to pass actual file data to the LLM.
 */
export async function loadRagMediaAttachments(
  app: App,
  mediaReferences: RagMediaReference[],
): Promise<import("src/types").Attachment[]> {
  const attachments: import("src/types").Attachment[] = [];

  for (const ref of mediaReferences) {
    try {
      const file = app.vault.getAbstractFileByPath(ref.filePath);
      if (!(file instanceof TFile)) continue;

      const mimeType = extensionToMimeType(file.extension);
      if (!mimeType) continue;

      const buffer = await app.vault.readBinary(file);
      const data = arrayBufferToBase64(buffer);

      attachments.push({
        name: file.name,
        type: ref.contentType,
        mimeType,
        data,
      });
    } catch (e) {
      console.error(`Failed to load RAG media attachment ${ref.filePath}:`, e);
    }
  }

  return attachments;
}

// Exported for testing
export { chunkText as _chunkText, cosineSimilarity as _cosineSimilarity, simpleChecksum as _simpleChecksum, shouldIncludeFile as _shouldIncludeFile };

// Singleton
let localRagStoreInstance: LocalRagStore | null = null;

export function getLocalRagStore(): LocalRagStore | null {
  return localRagStoreInstance;
}

export function initLocalRagStore(): LocalRagStore {
  if (!localRagStoreInstance) {
    localRagStoreInstance = new LocalRagStore();
  }
  return localRagStoreInstance;
}

export function resetLocalRagStore(): void {
  localRagStoreInstance = null;
}
