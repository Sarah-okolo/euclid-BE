// src/routes/chat.js
import express from "express";
import jwt from "jsonwebtoken";
import OpenAI from "openai";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { generateEmbedding } from "../services/embeddings.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: cosine similarity
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB);
}

/**
 * POST /api/chat
 * Handles user message → AI response with optional agentic action
 */
router.post("/", async (req, res) => {
  const db = getDB();
  try {
    const { botId, userMessage, userToken } = req.body;
    if (!botId || !userMessage || !userToken) {
      return res.status(400).json({ status: "failed", error: "Missing required fields" });
    }

    const cacheKey = `${botId}:${userMessage.trim().toLowerCase()}`;
    const cachedResponse = getCache(cacheKey);
    if (cachedResponse) return res.json({ botId, response: cachedResponse, cached: true });

    // ---- Parallel fetch bot config and embeddings ----
    const botsCollection = db.collection("bots");
    const embeddingsCollection = db.collection("embeddings");

    const [bot, embeddings, userVector] = await Promise.all([
      botsCollection.findOne({ botId }),
      embeddingsCollection.find({ botId }).toArray(),
      generateEmbedding(userMessage),
    ]);

    if (!bot) return res.status(404).json({ status: "failed", error: "Bot not found" });
    if (!embeddings.length) return res.status(404).json({ status: "failed", error: "No knowledge base found" });

    // ---- Step 1: Verify user token (decode only for MVP) ----
    let userPayload;
    try {
      userPayload = jwt.decode(userToken, { complete: true });
    } catch {
      return res.status(401).json({ status: "failed", error: "Invalid user token" });
    }

    // ---- Step 2: Top 5 relevant chunks ----
    const scored = embeddings
      .map((doc) => ({ ...doc, similarity: cosineSimilarity(userVector, doc.vector) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const contextText = scored.map((e) => e.content).join("\n\n");

    // ---- Step 3: Single LLM call for reasoning + response ----
    const combinedPrompt = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules: ${bot.defaultPrompt}.
User message: "${userMessage}"
Company knowledge:\n${contextText}
Instructions:
1. Decide if an action (calling an internal business API) is needed.
2. If yes, output JSON: { "action": "call_api", "endpoint": "/your/endpoint", "method": "POST", "payload": {...} }
3. If no action is needed, output JSON: { "action": "none" }
4. Then provide a complete user-facing answer, incorporating any action result if applicable.
Respond ONLY in JSON format:
{
  "action": "...",
  "endpoint": "...",
  "method": "...",
  "payload": {...},
  "answer": "..."
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: combinedPrompt }],
    });

    let aiOutput = { action: "none", answer: "" };
    try {
      aiOutput = JSON.parse(completion.choices[0].message.content);
    } catch {
      aiOutput = { action: "none", answer: completion.choices[0].message.content };
    }

    // ---- Step 4: Execute internal proxy if action required ----
    let proxyResult = null;
    if (aiOutput.action === "call_api") {
      const proxyResponse = await fetch(`${process.env.BACKEND_URL}/api/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          userToken,
          endpoint: aiOutput.endpoint,
          method: aiOutput.method,
          payload: aiOutput.payload,
        }),
      });
      proxyResult = await proxyResponse.json();
    }

    // ---- Step 5: Compose final answer ----
    let finalAnswer = aiOutput.answer || "";
    if (aiOutput.action === "call_api" && proxyResult) {
      finalAnswer += `\n\nAction executed result: ${JSON.stringify(proxyResult)}`;
    }

    // ---- Step 6: Cache + return ----
    setCache(cacheKey, finalAnswer);
    return res.json({ botId, response: finalAnswer, cached: false });
  } catch (err) {
    console.error("Error in chat endpoint:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

export default router;
