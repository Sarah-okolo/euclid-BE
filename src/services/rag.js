// src/services/rag.js
import { getDB } from "../config/db.js";
import crypto from "crypto";
import { generateEmbedding } from "./embeddings.js";
import { chunkText } from "../utils/textChunker.js";

/**
 * processDocument
 * Handles chunking, embedding, and storing for a bot's document
 * @param {string} botId
 * @param {string} text
 * @param {string} filename
 * @returns {boolean} success/failure
 */
export async function processDocument(botId, text, filename) {
  try {
    const db = getDB();
    const embeddingsCollection = db.collection("embeddings");

    // Step 1: chunk the text
    const chunks = chunkText(text, 800);

    // Step 2: generate embeddings for each chunk (sequentially for MVP)
    const docsToInsert = [];
    for (const chunk of chunks) {
      const vector = await generateEmbedding(chunk);
      docsToInsert.push({
        botId,
        chunkId: crypto.randomUUID(),
        content: chunk,
        filename,
        vector,
        createdAt: new Date(),
      });
    }

    // Step 3: insert all vectors into the DB
    await embeddingsCollection.insertMany(docsToInsert);
    return true;
  } catch (err) {
    console.error("Error in RAG processing:", err);
    return false;
  }
}
