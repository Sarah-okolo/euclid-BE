// src/services/vectorStore.js
import { getPineconeIndex } from "../config/pinecone.js";

/**
 * Upsert a batch of vectors into Pinecone under the bot's namespace.
 * @param {string} botId - namespace
 * @param {Array<{ id: string, embedding: number[], text: string, filename?: string, chunkIndex?: number }>} items
 */
export async function upsertEmbeddings(botId, items) {
  if (!items?.length) return;

  const index = getPineconeIndex();

  const vectors = items.map((it) => ({
    id: it.id,
    values: it.embedding,
    metadata: {
      text: it.text,
      filename: it.filename || null,
      chunkIndex: typeof it.chunkIndex === "number" ? it.chunkIndex : null,
      botId,
    },
  }));

  // Upsert in chunks of 100 to avoid payload bloat
  const BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await index.upsert(batch, { namespace: botId });
  }
}

/**
 * Query Pinecone with a query vector in bot's namespace.
 * Returns array of { text, score, metadata }
 * @param {string} botId
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {Promise<Array<{ text: string, score: number, metadata: Record<string, any> }>>}
 */
export async function querySimilar(botId, queryEmbedding, topK = 5) {
  const index = getPineconeIndex();

  const result = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
    namespace: botId,
  });

  const matches = result.matches || [];
  return matches.map((m) => ({
    text: m?.metadata?.text || "",
    score: typeof m.score === "number" ? m.score : 0,
    metadata: m.metadata || {},
  }));
}
