// src/config/pinecone.js
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";

dotenv.config();

if (!process.env.PINECONE_API_KEY) {
  console.log('process.env.PINECONE_API_KEY:', process.env.PINECONE_API_KEY);
  throw new Error("❌ PINECONE_API_KEY is not set in environment variables");
}

if (!process.env.PINECONE_INDEX) {
  throw new Error("❌ PINECONE_INDEX is not set in environment variables");
}

/**
 * Singleton Pinecone client used throughout the backend.
 * Automatically handles connection pooling for serverless indexes.
 */
export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

console.log("🍍 Pinecone client initialized successfully");

