import type { App } from "obsidian";
import { WORKSPACE_FOLDER } from "src/types";

const RAG_DIR = `${WORKSPACE_FOLDER}/rag`;
const INDEX_FILENAME = "index.json";
const VECTORS_FILENAME = "vectors.bin";

export interface LocalRagChunkMeta {
  filePath: string;
  chunkIndex: number;
  text: string;
}

export interface LocalRagIndex {
  meta: LocalRagChunkMeta[];
  dimension: number;
  fileChecksums: Record<string, string>;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
}

const EMPTY_INDEX: LocalRagIndex = {
  meta: [],
  dimension: 0,
  fileChecksums: {},
  embeddingModel: "",
  chunkSize: 0,
  chunkOverlap: 0,
};

function getSettingDir(settingName: string): string {
  return `${RAG_DIR}/${sanitizeSettingName(settingName)}`;
}

function getIndexPath(settingName: string): string {
  return `${getSettingDir(settingName)}/${INDEX_FILENAME}`;
}

function getVectorsPath(settingName: string): string {
  return `${getSettingDir(settingName)}/${VECTORS_FILENAME}`;
}

async function ensureDir(app: App, dirPath: string): Promise<void> {
  const wsExists = await app.vault.adapter.exists(WORKSPACE_FOLDER);
  if (!wsExists) {
    await app.vault.createFolder(WORKSPACE_FOLDER);
  }

  const ragExists = await app.vault.adapter.exists(RAG_DIR);
  if (!ragExists) {
    await app.vault.createFolder(RAG_DIR);
  }

  const dirExists = await app.vault.adapter.exists(dirPath);
  if (!dirExists) {
    await app.vault.createFolder(dirPath);
  }
}

export async function loadRagIndex(app: App, settingName: string): Promise<LocalRagIndex | null> {
  const indexPath = getIndexPath(settingName);
  try {
    const exists = await app.vault.adapter.exists(indexPath);
    if (!exists) return null;
    const content = await app.vault.adapter.read(indexPath);
    return JSON.parse(content) as LocalRagIndex;
  } catch {
    return null;
  }
}

export async function saveRagIndex(app: App, settingName: string, index: LocalRagIndex): Promise<void> {
  const dirPath = getSettingDir(settingName);
  await ensureDir(app, dirPath);

  const indexPath = getIndexPath(settingName);
  await app.vault.adapter.write(indexPath, JSON.stringify(index));
}

export async function loadRagVectors(app: App, settingName: string): Promise<Float32Array | null> {
  const vectorsPath = getVectorsPath(settingName);
  try {
    const exists = await app.vault.adapter.exists(vectorsPath);
    if (!exists) return null;
    const buffer = await app.vault.adapter.readBinary(vectorsPath);
    return new Float32Array(buffer);
  } catch {
    return null;
  }
}

export async function saveRagVectors(app: App, settingName: string, vectors: Float32Array): Promise<void> {
  const dirPath = getSettingDir(settingName);
  await ensureDir(app, dirPath);

  const vectorsPath = getVectorsPath(settingName);
  await app.vault.adapter.writeBinary(
    vectorsPath,
    vectors.buffer.slice(vectors.byteOffset, vectors.byteOffset + vectors.byteLength) as ArrayBuffer
  );
}

export async function deleteRagIndex(app: App, settingName: string): Promise<void> {
  const dirPath = getSettingDir(settingName);
  const indexPath = getIndexPath(settingName);
  const vectorsPath = getVectorsPath(settingName);
  try {
    if (await app.vault.adapter.exists(indexPath)) {
      await app.vault.adapter.remove(indexPath);
    }
    if (await app.vault.adapter.exists(vectorsPath)) {
      await app.vault.adapter.remove(vectorsPath);
    }
    if (await app.vault.adapter.exists(dirPath)) {
      await app.vault.adapter.rmdir(dirPath, true);
    }
  } catch {
    // Ignore deletion errors
  }
}

export function createEmptyIndex(): LocalRagIndex {
  return { ...EMPTY_INDEX, meta: [], fileChecksums: {} };
}

function sanitizeSettingName(settingName: string): string {
  return settingName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Load RAG index from an external (absolute) directory path using Node.js fs.
 */
export async function loadExternalRagIndex(dirPath: string): Promise<LocalRagIndex | null> {
  try {
    const fs = (globalThis as { require?: (id: string) => { promises: { readFile: (p: string, e: string) => Promise<string> } } }).require?.("fs");
    const path = (globalThis as { require?: (id: string) => { join: (...args: string[]) => string } }).require?.("path");
    if (!fs || !path) return null;
    const content = await fs.promises.readFile(path.join(dirPath, INDEX_FILENAME), "utf-8");
    return JSON.parse(content) as LocalRagIndex;
  } catch {
    return null;
  }
}

/**
 * Load RAG vectors from an external (absolute) directory path using Node.js fs.
 */
export async function loadExternalRagVectors(dirPath: string): Promise<Float32Array | null> {
  try {
    const fs = (globalThis as { require?: (id: string) => { promises: { readFile: (p: string) => Promise<Buffer> } } }).require?.("fs");
    const path = (globalThis as { require?: (id: string) => { join: (...args: string[]) => string } }).require?.("path");
    if (!fs || !path) return null;
    const buffer = await fs.promises.readFile(path.join(dirPath, VECTORS_FILENAME));
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  } catch {
    return null;
  }
}
