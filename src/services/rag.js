// src/services/rag.js
import crypto from "crypto";
import { chunkText } from "../utils/textChunker.js";
import { pinecone } from "../config/pinecone.js";

/**
 * processDocument
 * Chunk text and store embeddings directly in Pinecone using its built-in embedding model.
 * @param {string} botId
 * @param {string} text
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
export async function processDocument(botId, text, filename = "document.pdf") {
  try {
    // Split text into sentence-aware chunks
    const chunks = chunkText(text, 1200);
    if (!chunks.length) {
      console.warn("⚠️ No chunks generated from document text");
      return false;
    }

    console.log(`📘 Processing ${chunks.length} chunks for ${filename}`);

    // Get Pinecone index (ensure you have created it in dashboard)
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

    // Prepare upsert records — Pinecone will embed automatically
    const vectors = chunks.map((chunk, i) => ({
      id: `${botId}_${i}`,
      metadata: {
        botId,
        text: chunk,
        filename,
        chunkIndex: i,
      },
      // ✅ No manual 'values' — Pinecone handles embedding internally
      // ✅ Just pass the text content
      text: chunk,
    }));

    // Upsert in batches (safely handles large documents)
    const batchSize = 50;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);

      console.log(`🪄 Upserting batch ${Math.ceil(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}...`);

      await index.namespace(botId).upsert(batch, {
        // Tell Pinecone to embed the text automatically
        embed: { model: "text-embedding-ada-002" },
      });
    }

    console.log(`✅ Completed ingestion for ${filename} (${chunks.length} chunks total)`);
    return true;
  } catch (err) {
    console.error("❌ Error in RAG processing:", err);
    return false;
  }
}
