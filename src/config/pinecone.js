// src/config/pinecone.js
import { Pinecone } from "@pinecone-database/pinecone";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not set");
}
if (!process.env.PINECONE_INDEX) {
  throw new Error("PINECONE_INDEX is not set");
}

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

/**
 * Returns a Pinecone index handle.
 * Uses serverless indexes (no explicit environment needed).
 */
export function getPineconeIndex() {
  return pinecone.index(process.env.PINECONE_INDEX);
}
