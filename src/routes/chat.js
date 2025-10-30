// src/routes/chat.js
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

// ✅ Initialize Gemini client
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
  const { botId, message: userMessage, sessionId: userToken } = req.body;

  try {
    console.log("Chat request for bot:", req.body);

    if (!botId) {
      return res.status(400).json({ status: "failed", error: "Missing required field: botId" });
    }
    if (!userMessage) {
      return res.status(400).json({ status: "failed", error: "Missing required field: userMessage" });
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
      return res.status(404).json({ status: "failed", error: "Bot not found" });
    }

    // --- Step 3: Decode token (optional, for logs or personalization) ---
    let userPayload = null;
    if (userToken) {
      try {
        userPayload = jwt.decode(userToken, { complete: true });
      } catch {
        // Not critical, skip if invalid — verification happens in /api/proxy
      }
    }

    // --- Step 4: Retrieve top relevant context chunks ---
    const topChunks = await querySimilar(botId, userMessage, 5);
    if (!topChunks.length) {
      return res.status(404).json({
        status: "failed",
        error: "No knowledge base found for this bot",
      });
    }

    const contextText = topChunks.map((c, i) => `#${i + 1} ${c.text}`).join("\n\n");

    // --- Step 5: Add available API endpoints as context ---
    let endpointDescriptions = "None provided.";
    try {
      const endpoints = JSON.parse(bot.endpointRoles || "[]");
      if (endpoints.length > 0) {
        endpointDescriptions = endpoints
          .map((r) => `- ${r.endpoint} (${r.method || "ANY"}) — allowed roles: ${r.roles.join(", ")}`)
          .join("\n");
      }
    } catch {
      // Ignore parsing error — fallback to none
    }

    // --- Step 6: Build enhanced system instruction ---
    const systemInstruction = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules strictly: ${bot.defaultPrompt}.
You have access to internal business APIs and company knowledge provided below.
You can reason, decide, and call internal APIs securely through the system.

Always return a single valid JSON object that matches the schema.
Never include markdown or commentary outside the JSON.
`;

    // --- Step 7: Construct user prompt (RAG + endpoints awareness) ---
    const userPrompt = `
User message: "${userMessage}"

Company knowledge:
${contextText}

Available internal API endpoints:
${endpointDescriptions}

Instructions:
1. Determine if one of the above APIs matches the user's intent.
2. If yes, return: "action": "call_api" with "endpoint", "method", and "payload".
3. If no, return: "action": "none".
4. Always include a natural "answer" for the user (concise, direct, no repetition).
`;

    // --- Step 8: Define strict JSON schema ---
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
            example: { type: "string", nullable: true }, // 👈 required dummy key
          },
          additionalProperties: true,
        },
        answer: { type: "string" },
      },
      required: ["action", "answer"],
      additionalProperties: false,
    };


    // --- Step 9: Send to Gemini ---
    console.log("⚡ Sending enhanced prompt to Gemini...");

    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
      },
    });

    const rawText = response.response?.text || response.text || "";
    console.log("🧠 Gemini raw response:", rawText);

    // --- Step 10: Parse structured JSON ---
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

    // --- Step 11: Handle agentic API call ---
    let finalAnswer = aiJson.answer || "";
    if (aiJson.action === "call_api") {
      if (!userToken) {
        return res.status(401).json({
          status: "failed",
          error: "Authentication required for this action",
        });
      }

      const endpoint = aiJson.endpoint || "";
      const method = aiJson.method || "GET";
      const payload = aiJson.payload || {};

      if (!endpoint) {
        return res.status(400).json({
          status: "failed",
          error: "LLM requested action but did not specify endpoint",
        });
      }

      console.log(`🤖 Executing agentic action → ${method} ${endpoint}`);

      try {
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

        if (!proxyResponse.ok) {
          const errBody = await proxyResponse.text();
          finalAnswer += `\n\n⚠️ The system attempted to call ${endpoint} but received an error (${proxyResponse.status}): ${errBody}`;
        } else {
          const proxyResult = await proxyResponse.json();
          finalAnswer += `\n\n✅ Action executed result: ${JSON.stringify(proxyResult)}`;
        }
      } catch (error) {
        console.error("Proxy call failed:", error);
        finalAnswer += `\n\n⚠️ The system attempted to call ${endpoint}, but the request failed to reach the backend. (${error.message})`;
      }
    }

    // --- Step 12: Cache and return ---
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
