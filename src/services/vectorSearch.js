// src/services/vectorSearch.js
import { getDB } from "../config/db.js";

/**
 * searchEmbeddings
 * @param {string} botId
 * @param {number[]} queryVector
 * @param {number} topK
 * @returns {Promise<Array>} - top K most similar chunks
 */
export async function searchEmbeddings(botId, queryVector, topK = 5) {
  const db = getDB();
  const embeddingsCollection = db.collection("embeddings");

  // MongoDB doesn’t support vector search natively; compute cosine similarity manually
  const allChunks = await embeddingsCollection.find({ botId }).toArray();

  const similarity = (vecA, vecB) => {
    const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dot / (magA * magB + 1e-10);
  };

  const scored = allChunks.map((chunk) => ({
    ...chunk,
    score: similarity(chunk.vector, queryVector),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
