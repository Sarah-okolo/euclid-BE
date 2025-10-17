// src/services/embeddings.js
import { gemini } from "../config/gemini.js";

/**
 * Generate a single embedding vector for text using Gemini's 768-dimension model.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  try {
    const model = gemini.getGenerativeModel({ model: "models/embedding-001" });
    const result = await model.embedContent(text);

    const embedding = result.embedding?.values;
    if (!embedding) throw new Error("No embedding returned from Gemini");

    return embedding;
  } catch (err) {
    console.error("Error generating single embedding:", err);
    throw err;
  }
}

/**
 * Generate embeddings for multiple texts efficiently.
 * Breaks requests into small batches and respects Gemini rate limits.
 * @param {string[]} texts
 * @param {number} [batchSize=10] - number of chunks to embed per batch
 * @param {number} [delayMs=1500] - delay between batches (ms)
 * @returns {Promise<number[][]>}
 */
export async function generateEmbeddingsBatch(texts, batchSize = 10, delayMs = 1500) {
  try {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const model = gemini.getGenerativeModel({ model: "models/embedding-001" });
    const embeddings = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      console.log(`Embedding batch ${Math.ceil(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`);

      // Call Gemini in parallel for small groups (safe within rate limits)
      const results = await Promise.allSettled(
        batch.map(async (text) => {
          const result = await model.embedContent(text);
          return result.embedding?.values || null;
        })
      );

      // Filter successful embeddings
      results.forEach((res) => {
        if (res.status === "fulfilled" && res.value) embeddings.push(res.value);
      });

      // Small delay between batches to avoid 429 throttling
      if (i + batchSize < texts.length) {
        console.log(`Waiting ${delayMs}ms to respect Gemini rate limits...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    console.log(`✅ Generated ${embeddings.length}/${texts.length} embeddings successfully.`);
    return embeddings;
  } catch (err) {
    console.error("Error generating batch embeddings:", err);
    throw err;
  }
}
