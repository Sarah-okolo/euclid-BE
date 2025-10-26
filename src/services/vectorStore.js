// src/services/vectorStore.js
import { pinecone } from "../config/pinecone.js";

/**
 * Upsert text chunks directly into Pinecone (Serverless Index).
 * Pinecone handles embedding automatically.
 *
 * @param {string} botId - Namespace for this bot
 * @param {Array<{ id: string, text: string, metadata?: Record<string, any> }>} items
 */
export async function upsertEmbeddings(botId, items) {
  if (!items?.length) {
    console.warn("⚠️ vectorStore: No items to upsert.");
    return;
  }

  const indexName = process.env.PINECONE_INDEX;
  const indexHost = process.env.PINECONE_INDEX_HOST;
  if (!indexName) throw new Error("PINECONE_INDEX not set");
  if (!indexHost) throw new Error("PINECONE_INDEX_HOST not set");

  const namespace = pinecone.index(indexName, indexHost).namespace(botId);
  console.log(`📦 vectorStore: Upserting ${items.length} chunks → index "${indexName}" (namespace: ${botId})`);

  try {
    // ✅ move metadata fields to the top level (not inside a "fields" object)
    const records = items.map((it) => ({
      _id: it.id,
      text: it.text,
      botId,
      filename: it.metadata?.filename ?? "unknown",
      chunkIndex: it.metadata?.chunkIndex ?? 0,
      length: it.text?.length ?? 0,
    }));

    console.log(`🔄 vectorStore: Upserting ${records.length} records for bot ${botId}...`);
    await namespace.upsertRecords(records);

    console.log(`✅ vectorStore: Successfully upserted ${records.length} records for bot ${botId}`);
  } catch (err) {
    console.error("❌ vectorStore: Upsert failed:", err);
    throw err;
  }
}

/**
 * Query similar text chunks from Pinecone (Serverless Index).
 * Pinecone auto-embeds the query text — no external embedding model required.
 */
export async function querySimilar(botId, queryText, topK = 5) {
  const indexName = process.env.PINECONE_INDEX;
  const indexHost = process.env.PINECONE_INDEX_HOST;
  if (!indexName) throw new Error("PINECONE_INDEX not set");
  if (!indexHost) throw new Error("PINECONE_INDEX_HOST not set");

  const namespace = pinecone.index(indexName, indexHost).namespace(botId);

  try {
    console.log(`🔍 vectorStore: Searching top ${topK} matches for "${queryText}" in namespace "${botId}"`);

    const results = await namespace.searchRecords({
      query: {
        inputs: { text: queryText },
        topK,
      },
    });

    const hits = results.result?.hits || [];
    console.log(`✅ vectorStore: Found ${hits.length} matches for ${botId}`);

    return hits.map((hit) => ({
      id: hit._id,
      text: hit.fields?.text || hit.text || "",
      score: hit._score || 0,
      fields: hit.fields || {},
    }));
  } catch (err) {
    console.error("❌ vectorStore: Query failed:", err);
    return [];
  }
}
