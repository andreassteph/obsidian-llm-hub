import { requestUrl } from "obsidian";

const EMBEDDING_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/embeddings";
const BATCH_SIZE = 32;

export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
  model: string
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await requestUrl({
      url: EMBEDDING_API_URL,
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
