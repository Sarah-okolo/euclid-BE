// src/config/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set");
}

/**
 * Singleton Gemini client for both embeddings and generation.
 * Uses the production Gemini API (not v1beta).
 */
export const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);