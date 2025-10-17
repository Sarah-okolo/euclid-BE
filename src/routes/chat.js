// src/routes/chat.js
import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { searchEmbeddings } from "../services/vectorSearch.js";
import { gemini } from "../config/gemini.js";
import { getCache, setCache } from "../utils/cache.js";

const router = express.Router();

/**
 * POST /api/chat
 * User message → RAG context → Gemini structured JSON (action + answer) → optional proxy call → final answer
 */
router.post("/", async (req, res) => {
  const db = getDB();
  try {
    const { botId, userMessage, userToken } = req.body;
    if (!botId || !userMessage || !userToken) {
      return res.status(400).json({ status: "failed", error: "Missing required fields" });
    }

    // Cache (per bot+message)
    const cacheKey = `${botId}:${userMessage.trim().toLowerCase()}`;
    const cachedResponse = getCache(cacheKey);
    if (cachedResponse) return res.json({ botId, response: cachedResponse, cached: true });

    // Fetch bot config
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId });
    if (!bot) return res.status(404).json({ status: "failed", error: "Bot not found" });

    // Step 1: Decode (not verify) token to get basic context quickly (verification happens in /proxy)
    let userPayload = null;
    try {
      userPayload = jwt.decode(userToken, { complete: true });
    } catch {
      // allow flow; verification happens before any real API call
    }

    // Step 2: Retrieve top 5 relevant chunks from Pinecone
    const topChunks = await searchEmbeddings(botId, userMessage, 5);
    const contextText = topChunks.map((c, i) => `#${i + 1} ${c.text}`).join("\n\n");
    if (!contextText) {
      return res.status(404).json({ status: "failed", error: "No knowledge base found" });
    }

    // Step 3: Build system + user instruction for strict JSON output
    // Use responseMimeType + schema to force well-formed JSON with Gemini 1.5/2.5 models
    const systemInstruction = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules: ${bot.defaultPrompt}
You MUST return a strictly valid JSON object matching the provided schema.
Never include markdown fences or extra commentary outside JSON.
`;

    const responseSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["none", "call_api"] },
        endpoint: { type: "string", nullable: true },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], nullable: true },
        payload: { type: "object", additionalProperties: true, nullable: true },
        answer: { type: "string" },
      },
      required: ["action", "answer"],
      additionalProperties: false,
    };

    const prompt = [
      {
        role: "user",
        parts: [
          {
            text:
              `User message: "${userMessage}"

Company knowledge:
${contextText}

Instructions:
1. Decide if an action (calling a secured business API) is needed.
2. If yes, set: "action": "call_api", and include "endpoint", "method", "payload".
3. If no, set: "action": "none".
4. Always include an "answer" for the user (concise, helpful, cite internal info where relevant).`,
          },
        ],
      },
    ];

    // Step 4: Call Gemini (fast + reliable JSON mode)
    const genResponse = await gemini.models.generateContent({
      model: "gemini-2.5-flash", // fast + supports JSON structured output
      contents: prompt,
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema,
    });

    // The SDK returns .text (already JSON string due to responseMimeType)
    let aiJson;
    try {
      aiJson = JSON.parse(genResponse.text);
    } catch (e) {
      console.error("Failed to parse Gemini JSON:", genResponse?.text);
      return res.status(502).json({ status: "failed", error: "LLM output parse error" });
    }

    // Step 5: Execute proxy if action required
    let finalAnswer = aiJson.answer || "";
    if (aiJson.action === "call_api") {
      // Ensure required fields exist
      const endpoint = aiJson.endpoint || "";
      const method = aiJson.method || "GET";
      const payload = aiJson.payload || {};

      if (!endpoint || typeof endpoint !== "string") {
        return res.status(400).json({ status: "failed", error: "LLM requested action without endpoint" });
      }

      const proxyResponse = await fetch(`${process.env.BACKEND_URL}/api/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, userToken, endpoint, method, payload }),
      });

      const proxyResult = await proxyResponse.json();

      // Compose final answer with proxy result attached
      finalAnswer = `${finalAnswer}\n\nAction executed result: ${JSON.stringify(proxyResult)}`;
    }

    // Step 6: Cache + return
    setCache(cacheKey, finalAnswer);
    return res.json({ botId, response: finalAnswer, cached: false });
  } catch (err) {
    console.error("❌ Error in chat endpoint:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

export default router;
