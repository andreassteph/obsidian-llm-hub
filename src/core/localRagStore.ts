import type { App, TFile } from "obsidian";
import { generateEmbeddings } from "./embeddingProvider";
import {
  type LocalRagIndex,
  type LocalRagChunkMeta,
  loadRagIndex,
  saveRagIndex,
  loadRagVectors,
  saveRagVectors,
  deleteRagIndex,
  createEmptyIndex,
} from "./localRagStorage";
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
}

export interface LocalRagStatus {
  chunkCount: number;
  fileCount: number;
  dimension: number;
  embeddingModel: string;
}

class LocalRagStore {
  private app: App | null = null;
  private entries = new Map<string, { index: LocalRagIndex | null; vectors: Float32Array | null }>();

  async load(app: App, settingNames: string[]): Promise<void> {
    this.app = app;
    for (const settingName of settingNames) {
      await this.ensureLoaded(app, settingName);
    }
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
    embeddingBaseUrl?: string
  ): Promise<{ embedded: number; skipped: number; removed: number; errors: string[] }> {
    this.app = app;
    const result = { embedded: 0, skipped: 0, removed: 0, errors: [] as string[] };
    const entry = await this.ensureLoaded(app, settingName);
    let index = entry.index;
    let vectors = entry.vectors;

    // Check if we need full rebuild (model or chunk params changed)
    const needsFullRebuild = index !== null && (
      index.embeddingModel !== model ||
      index.chunkSize !== chunkSize ||
      index.chunkOverlap !== chunkOverlap
    );

    if (needsFullRebuild) {
      index = null;
      vectors = null;
    }

    if (!index) {
      index = createEmptyIndex();
    }

    // Get all eligible .md files
    const allFiles = app.vault.getFiles().filter(
      (f: TFile) => f.extension === "md" && shouldIncludeFile(f.path, filterConfig)
    );

    // Calculate checksums for current files (cache content for files that need embedding)
    const currentChecksums: Record<string, string> = {};
    const contentCache = new Map<string, string>();
    for (const file of allFiles) {
      const content = await app.vault.read(file);
      currentChecksums[file.path] = simpleChecksum(content);
      contentCache.set(file.path, content);
    }

    // Determine which files need updating
    const filesToEmbed: string[] = [];
    const filesToKeep: string[] = [];
    const currentFilePaths = new Set(allFiles.map(f => f.path));

    for (const file of allFiles) {
      const existingChecksum = index.fileChecksums[file.path];
      if (existingChecksum && existingChecksum === currentChecksums[file.path]) {
        filesToKeep.push(file.path);
      } else {
        filesToEmbed.push(file.path);
      }
    }

    // Remove chunks from deleted/changed files
    const filesToRemove = Object.keys(index.fileChecksums).filter(
      p => !currentFilePaths.has(p) || filesToEmbed.includes(p)
    );

    // Build new index from kept files
    const keptMeta: LocalRagChunkMeta[] = [];
    const keptVectorParts: Float32Array[] = [];

    if (vectors && index.dimension > 0) {
      for (let origIdx = 0; origIdx < index.meta.length; origIdx++) {
        const meta = index.meta[origIdx];
        if (filesToKeep.includes(meta.filePath)) {
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
    result.skipped = filesToKeep.length;

    const totalOps = filesToEmbed.length + filesToRemove.length + filesToKeep.length;

    // Report skipped/removed files
    for (let i = 0; i < filesToKeep.length; i++) {
      onProgress?.(i + 1, totalOps, filesToKeep[i], "skip");
    }
    for (let i = 0; i < filesToRemove.length; i++) {
      onProgress?.(filesToKeep.length + i + 1, totalOps, filesToRemove[i], "remove");
    }

    // Embed new/changed files
    const newMeta: LocalRagChunkMeta[] = [];
    const newVectorParts: Float32Array[] = [];
    const embeddedChecksums: Record<string, string> = {};
    let dimension = index.dimension;
    let currentOp = filesToKeep.length + filesToRemove.length;

    for (const filePath of filesToEmbed) {
      currentOp++;
      onProgress?.(currentOp, totalOps, filePath, "embed");

      try {
        const content = contentCache.get(filePath);
        if (!content) continue;
        const chunks = chunkText(content, chunkSize, chunkOverlap);
        if (chunks.length === 0) continue;

        const embeddings = await generateEmbeddings(chunks, apiKey, model, embeddingBaseUrl);
        if (embeddings.length > 0) {
          dimension = embeddings[0].length;
        }

        for (let i = 0; i < chunks.length; i++) {
          newMeta.push({ filePath, chunkIndex: i, text: chunks[i] });
          newVectorParts.push(new Float32Array(embeddings[i]));
        }
        result.embedded++;
        embeddedChecksums[filePath] = currentChecksums[filePath];
      } catch (error) {
        result.errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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
    for (const path of filesToKeep) {
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
    embeddingBaseUrl?: string
  ): Promise<LocalRagSearchResult[]> {
    if (!this.app) {
      return [];
    }

    const entry = await this.ensureLoaded(this.app, settingName);
    const { index, vectors } = entry;
    if (!index || !vectors || index.meta.length === 0) {
      return [];
    }

    const [queryEmbedding] = await generateEmbeddings([query], apiKey, model, embeddingBaseUrl);
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
      .filter(r => r.score > 0)
      .map(r => ({
        filePath: index.meta[r.index].filePath,
        text: index.meta[r.index].text,
        score: r.score,
        chunkIndex: index.meta[r.index].chunkIndex,
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
      fileCount: Object.keys(entry.index.fileChecksums).length,
      dimension: entry.index.dimension,
      embeddingModel: entry.index.embeddingModel,
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

    const index = await loadRagIndex(app, settingName);
    const vectors = index && index.meta.length > 0
      ? await loadRagVectors(app, settingName)
      : null;
    const entry = { index, vectors };
    this.entries.set(settingName, entry);
    return entry;
  }
}

export function buildLocalRagContext(results: LocalRagSearchResult[]): string {
  if (results.length === 0) return "";

  let context = "\n\n--- Relevant context from vault (semantic search) ---\n";
  for (const r of results) {
    context += `\n[Source: ${r.filePath}] (relevance: ${r.score.toFixed(3)})\n${r.text}\n`;
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

export async function searchLocalRag(
  settingName: string,
  query: string,
  apiKey: string,
  embeddingModel: string,
  topK: number,
  embeddingBaseUrl?: string
): Promise<{ context: string; sources: string[] }> {
  const store = getLocalRagStore();
  if (!store || !apiKey) {
    return { context: "", sources: [] };
  }
  const results = await store.search(settingName, query, apiKey, embeddingModel, topK, embeddingBaseUrl);
  if (results.length === 0) {
    return { context: "", sources: [] };
  }
  return {
    context: buildLocalRagContext(results),
    sources: [...new Set(results.map(r => r.filePath))],
  };
}

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
