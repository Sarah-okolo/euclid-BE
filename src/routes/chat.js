// src/routes/chat.js
import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { querySimilar } from "../services/vectorStore.js";
import { getCache, setCache } from "../utils/cache.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

// ✅ Initialize Gemini client (for chat generation only)
const gemini = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * POST /api/chat
 * Handles user chat messages with RAG + optional API call execution.
 */
router.post("/", async (req, res) => {
  const db = getDB();

  try {
    const { botId, userMessage, userToken } = req.body;
    if (!botId || !userMessage || !userToken) {
      return res.status(400).json({
        status: "failed",
        error: "Missing required fields (botId, userMessage, userToken)",
      });
    }

    // --- Step 1: Cache lookup ---
    const cacheKey = `${botId}:${userMessage.trim().toLowerCase()}`;
    const cachedResponse = getCache(cacheKey);
    if (cachedResponse)
      return res.json({ botId, response: cachedResponse, cached: true });

    // --- Step 2: Fetch bot configuration ---
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId });
    if (!bot)
      return res
        .status(404)
        .json({ status: "failed", error: "Bot not found" });

    // --- Step 3: Decode token (non-blocking) ---
    let userPayload = null;
    try {
      userPayload = jwt.decode(userToken, { complete: true });
    } catch {
      // Skip verification here; it's handled in /api/proxy
    }

    // --- Step 4: Retrieve top relevant context chunks from Pinecone ---
    const topChunks = await querySimilar(botId, userMessage, 5);
    if (!topChunks.length)
      return res.status(404).json({
        status: "failed",
        error: "No knowledge base found for this bot",
      });

    const contextText = topChunks
      .map((c, i) => `#${i + 1} ${c.text}`)
      .join("\n\n");

    // --- Step 5: Build strict JSON generation instruction for Gemini ---
    const systemInstruction = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules strictly: ${bot.defaultPrompt}.
You have access to internal business data and must reason using the context provided.
Always return a single valid JSON object that matches the schema. 
Never include markdown, commentary, or text outside the JSON object.
`;

    const responseSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["none", "call_api"] },
        endpoint: { type: "string", nullable: true },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          nullable: true,
        },
        payload: { type: "object", additionalProperties: true, nullable: true },
        answer: { type: "string" },
      },
      required: ["action", "answer"],
      additionalProperties: false,
    };

    const userPrompt = `
User message: "${userMessage}"

Company knowledge:
${contextText}

Instructions:
1. Decide if an internal API action is needed.
2. If yes, return: "action": "call_api", with "endpoint", "method", and "payload".
3. If no, return: "action": "none".
4. Always include a concise "answer" for the user (helpful, natural, no repetition).
`;

    // --- Step 6: Generate response using Gemini ---
    const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });
    const genResponse = await model.generateContent({
      contents: [
        { role: "system", parts: [{ text: systemInstruction }] },
        { role: "user", parts: [{ text: userPrompt }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
      },
    });

    // Parse structured JSON output
    let aiJson;
    try {
      aiJson = JSON.parse(genResponse.response?.text || "{}");
    } catch (e) {
      console.error("❌ Failed to parse Gemini JSON:", genResponse?.response?.text);
      return res
        .status(502)
        .json({ status: "failed", error: "Failed to parse LLM response" });
    }

    // --- Step 7: Optionally perform business API call ---
    let finalAnswer = aiJson.answer || "";
    if (aiJson.action === "call_api") {
      const endpoint = aiJson.endpoint || "";
      const method = aiJson.method || "GET";
      const payload = aiJson.payload || {};

      if (!endpoint) {
        return res.status(400).json({
          status: "failed",
          error: "LLM requested action but did not specify endpoint",
        });
      }

      const proxyResponse = await fetch(`${process.env.BACKEND_URL}/api/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          userToken,
          endpoint,
          method,
          payload,
        }),
      });

      const proxyResult = await proxyResponse.json();
      finalAnswer += `\n\nAction executed result: ${JSON.stringify(proxyResult)}`;
    }

    // --- Step 8: Cache and return ---
    setCache(cacheKey, finalAnswer);
    return res.json({ botId, response: finalAnswer, cached: false });
  } catch (err) {
    console.error("❌ Error in chat endpoint:", err);
    return res
      .status(500)
      .json({ status: "failed", error: "Internal server error" });
  }
});

export default router;
