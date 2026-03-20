import { requestUrl } from "obsidian";

const EMBEDDING_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/embeddings";
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/models";
const BATCH_SIZE = 32;

interface OpenAiModel {
  id: string;
  object?: string;
}

interface OpenAiModelsResponse {
  data: OpenAiModel[];
}

const EMBEDDING_NAME_PATTERN = /embed|bge-|e5-|gte-|arctic-embed/i;

/** Ollama model family names that are embedding-only */
const EMBEDDING_FAMILIES = new Set(["nomic-bert", "bert", "snowflake-arctic-embed"]);

/**
 * Fetch available embedding models from the server.
 * - When baseUrl is empty: fetches from Gemini API and filters for embedding models.
 * - When baseUrl is set: tries Ollama /api/tags first, then falls back to OpenAI-compatible /v1/models.
 */
export async function fetchEmbeddingModels(
  apiKey: string,
  baseUrl?: string
): Promise<string[]> {
  if (!baseUrl) {
    // Gemini API: fetch all models and filter by name
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const response = await requestUrl({ url: GEMINI_MODELS_URL, method: "GET", headers });
    const data = response.json as OpenAiModelsResponse;
    return (data.data || []).map(m => m.id).filter(name => EMBEDDING_NAME_PATTERN.test(name));
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // Try Ollama /api/tags first (has family info for precise embedding model filtering)
  try {
    const ollamaResp = await requestUrl({ url: `${normalizedBase}/api/tags`, method: "GET" });
    const ollamaData = ollamaResp.json as {
      models?: { name: string; details?: { families?: string[] } }[];
    };
    if (ollamaData.models) {
      return ollamaData.models
        .filter(m => isOllamaEmbeddingModel(m.details?.families) || EMBEDDING_NAME_PATTERN.test(m.name))
        .map(m => m.name);
    }
  } catch {
    // Not Ollama — fall through to OpenAI-compatible
  }

  // OpenAI-compatible /v1/models (LM Studio, vLLM, etc.)
  const response = await requestUrl({ url: `${normalizedBase}/v1/models`, method: "GET", headers });
  const data = response.json as OpenAiModelsResponse;
  return (data.data || []).map(m => m.id).filter(name => EMBEDDING_NAME_PATTERN.test(name));
}

function isOllamaEmbeddingModel(families?: string[]): boolean {
  if (!families) return false;
  return families.some(f => EMBEDDING_FAMILIES.has(f));
}

export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
  model: string,
  baseUrl?: string
): Promise<number[][]> {
  const results: number[][] = [];
  const url = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`
    : EMBEDDING_API_URL;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: batch,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Embedding API error: ${response.status} ${response.text}`);
    }

    const data = response.json as {
      data: Array<{ embedding: number[] }>;
    };

    for (const item of data.data) {
      results.push(item.embedding);
    }
  }

  return results;
}
