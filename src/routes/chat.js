import express from "express";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getDB } from "../config/db.js";
import { querySimilar } from "../services/vectorStore.js";
import { getCache, setCache } from "../utils/cache.js";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const router = express.Router();

// ✅ Initialize Gemini client (new SDK)
const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * POST /api/chat
 * Handles user chat messages with RAG + optional API call execution.
 */
router.post("/", async (req, res) => {
  console.log("🔑 Gemini API Key:", process.env.GEMINI_API_KEY);
  const db = getDB();
  const userMessage = req.body.message;
  const userToken = req.body.sessionId;

  try {
    const { botId } = req.body;
    console.log("Chat request for bot:", req.body);

    if (!botId) {
      return res.status(400).json({
        status: "failed",
        error: "Missing required field: botId",
      });
    }
    if (!userMessage) {
      return res.status(400).json({
        status: "failed",
        error: "Missing required field: userMessage",
      });
    }
    if (!userToken) {
      return res.status(400).json({
        status: "failed",
        error: "Missing required field: userToken",
      });
    }

    // --- Step 1: Cache lookup ---
    const cacheKey = `${botId}:${userMessage.trim().toLowerCase()}`;
    const cachedResponse = getCache(cacheKey);
    if (cachedResponse) {
      return res.json({ botId, response: cachedResponse, cached: true });
    }

    // --- Step 2: Fetch bot configuration ---
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId });
    if (!bot) {
      return res.status(404).json({
        status: "failed",
        error: "Bot not found",
      });
    }

    // --- Step 3: Decode token (non-blocking) ---
    let userPayload = null;
    try {
      userPayload = jwt.decode(userToken, { complete: true });
    } catch {
      // Skip verification here; it's handled in /api/proxy
    }

    // --- Step 4: Retrieve top relevant context chunks ---
    const topChunks = await querySimilar(botId, userMessage, 5);
    console.log("top chunks", topChunks);

    if (!topChunks.length) {
      return res.status(404).json({
        status: "failed",
        error: "No knowledge base found for this bot",
      });
    }

    const contextText = topChunks
      .map((c, i) => `#${i + 1} ${c.text}`)
      .join("\n\n");

    // --- Step 5: Build instruction ---
    const systemInstruction = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules strictly: ${bot.defaultPrompt}.
You have access to internal business data and must reason using the context provided.
Always return a single valid JSON object that matches the schema. 
Never include markdown, commentary, or text outside the JSON object.
`;

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

    // ✅ FIXED SCHEMA: payload has at least one placeholder property
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
        payload: {
          type: "object",
          nullable: true,
          properties: {
            data: { type: "string", nullable: true },
          },
          additionalProperties: true,
        },
        answer: { type: "string" },
      },
      required: ["action", "answer"],
      additionalProperties: false,
    };

    // --- Step 6: Generate response using Gemini ---
    console.log("⚡ Sending prompt to Gemini...");

    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      // ✅ Moved "systemInstruction" here instead of role: "system"
      systemInstruction,
      contents: [
        { role: "user", parts: [{ text: userPrompt }] },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
      },
    });

    const rawText = response.response?.text || response.text || "";
    console.log("🧠 Gemini raw response:", rawText);

    // --- Step 7: Parse structured JSON ---
    let aiJson;
    try {
      aiJson = JSON.parse(rawText);
    } catch (e) {
      console.error("❌ Failed to parse Gemini JSON:", rawText);
      return res.status(502).json({
        status: "failed",
        error: "Failed to parse LLM response",
      });
    }

    // --- Step 8: Handle API call if requested ---
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

    // --- Step 9: Cache and return ---
    setCache(cacheKey, finalAnswer);
    return res.status(200).json({ botId, response: finalAnswer, cached: false });
  } catch (err) {
    console.error("❌ Error in chat endpoint:", err);
    return res.status(500).json({
      status: "failed",
      error: "Internal server error",
    });
  }
});

export default router;
