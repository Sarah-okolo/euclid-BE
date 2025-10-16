// src/services/embeddings.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * generateEmbedding
 * @param {string} text - the text to embed
 * @returns {Promise<number[]>} - embedding vector
 */
export async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    return response.data[0].embedding;
  } catch (err) {
    console.error("Error generating embedding:", err);
    throw err;
  }
}
