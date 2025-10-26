// src/services/rag.js
import { chunkText } from "../utils/textChunker.js";
import { upsertEmbeddings } from "./vectorStore.js";

/**
 * processDocument
 * Splits text into chunks and uploads them to Pinecone.
 * Pinecone (serverless) automatically handles embedding for each chunk.
 *
 * @param {string} botId - Namespace for Pinecone
 * @param {string} text - Extracted text from PDF or other document
 * @param {string} [filename="document.pdf"]
 * @returns {Promise<boolean>} success/failure
 */
export async function processDocument(botId, text, filename = "document.pdf") {
  try {
    if (!text || !text.trim()) {
      console.error("❌ RAG: Empty or invalid text input");
      return false;
    }

    // Split text into semantic chunks (~1000 characters)
    const chunks = chunkText(text, 1000);
    if (!chunks.length) {
      console.error("❌ RAG: No valid chunks generated from document");
      return false;
    }

    console.log(`📄 RAG: Processing ${chunks.length} chunks for bot "${botId}" (${filename})`);

    // Prepare items for Pinecone
    const items = chunks.map((chunk, i) => ({
      id: `${botId}_${Date.now()}_${i}`, // ✅ unique and collision-safe ID
      text: chunk,
      metadata: {
        botId,
        filename,
        chunkIndex: i,
        length: chunk.length,
      },
    }));

    // Upload chunks to Pinecone (auto-embeds via serverless mode)
    await upsertEmbeddings(botId, items);

    console.log(`✅ RAG: Successfully uploaded ${chunks.length} chunks for bot "${botId}"`);
    return true;
  } catch (err) {
    console.error("❌ RAG: Document processing failed:", err);
    return false;
  }
}
