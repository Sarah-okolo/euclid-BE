// src/services/vectorSearch.js
import { querySimilar } from "./vectorStore.js";
import { generateEmbedding } from "./embeddings.js";

/**
 * Retrieve top-k relevant chunks for a query using Pinecone.
 * @param {string} botId
 * @param {string} queryText
 * @param {number} topK
 */
export async function searchEmbeddings(botId, queryText, topK = 5) {
  const queryEmbedding = await generateEmbedding(queryText, "RETRIEVAL_QUERY");
  const results = await querySimilar(botId, queryEmbedding, topK);

  return results.map((r) => ({
    text: r.text,
    similarity: r.score, // Pinecone returns similarity score
    metadata: r.metadata,
  }));
}
