// src/utils/textChunker.js

/**
 * Splits text into smaller chunks for embeddings.
 * Uses sentence-aware chunking to keep context coherent.
 * @param {string} text
 * @param {number} chunkSize
 */
export function chunkText(text, chunkSize = 800) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);

  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}
