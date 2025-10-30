import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getDB } from "../config/db.js";
import { querySimilar } from "../services/vectorStore.js";
import { getCache, setCache } from "../utils/cache.js";
import { GoogleGenAI } from "@google/genai";
import { authz } from "../middleware/authz.js";
import { OpenFgaClient } from "@openfga/sdk";

dotenv.config();

const router = express.Router();
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Lazily initialize the FGA client
 */
let fga = null;
function getFgaClient() {
  const {
    FGA_API_URL,
    FGA_STORE_ID,
    FGA_CLIENT_ID,
    FGA_CLIENT_SECRET,
    FGA_API_AUDIENCE,
  } = process.env;

  if (!FGA_API_URL || !FGA_STORE_ID || !FGA_CLIENT_ID || !FGA_CLIENT_SECRET || !FGA_API_AUDIENCE) {
    console.warn("⚠️ Skipping FGA init: missing env vars");
    return null;
  }

  if (!fga) {
    console.log("✅ Initializing OpenFGA client...");
    fga = new OpenFgaClient({
      apiUrl: FGA_API_URL,
      storeId: FGA_STORE_ID,
      credentials: {
        method: "client_credentials",
        clientId: FGA_CLIENT_ID,
        clientSecret: FGA_CLIENT_SECRET,
        apiAudience: FGA_API_AUDIENCE,
      },
    });
  }

  return fga;
}

/**
 * Helper: Check FGA access for each document
 */
async function checkFgaAccess(userSub, botId, filename) {
  try {
    const fgaClient = getFgaClient();
    if (!fgaClient) {
      console.warn("⚠️ FGA client unavailable — skipping document-level access control");
      return true; // Allow all when FGA is not configured
    }

    const resp = await fgaClient.check({
      tuple_key: {
        user: `user:${userSub}`,
        relation: "reader",
        object: `document:${botId}/${filename}`,
      },
    });

    return Boolean(resp?.allowed);
  } catch (err) {
    console.error("FGA check failed:", err);
    return false;
  }
}

/**
 * POST /api/chat
 * Secure chat handler integrating Auth0 (user) and FGA (document-level control)
 */
router.post("/", authz(), async (req, res) => {
  const db = getDB();
  const { message: userMessage } = req.body;
  const { bot, token, user } = req;

  try {
    if (!userMessage) {
      return res.status(400).json({ status: "failed", error: "Missing required field: message" });
    }

    console.log(`💬🎊 Chat: Received message: "${userMessage}" for bot ${bot?.botId} from user ${user?.sub}`);

    // Cache lookup
    const cacheKey = `${bot?.botId}:${userMessage.trim().toLowerCase()}`;
    const cachedResponse = getCache(cacheKey);
    if (cachedResponse) {
      return res.json({ botId: bot.botId, response: cachedResponse, cached: true });
    }

    // RAG vector query
    const topChunks = await querySimilar(bot?.botId, userMessage, 5);

    // // FGA checks on chunks
    // const allowedChunks = [];
    // for (const c of topChunks) {
    //   const allowed = await checkFgaAccess(user?.sub, bot?.botId, c.metadata?.filename || "unknown");
    //   if (allowed) allowedChunks.push(c);
    // }

    // if (!allowedChunks.length) {
    //   return res.status(403).json({
    //     status: "failed",
    //     error: "You are not authorized to access any relevant documents.",
    //   });
    // }

    // const contextText = allowedChunks.map((c, i) => `#${i + 1} ${c.text}`).join("\n\n");

    // Endpoint summary
    const endpoints = JSON.parse(bot?.endpointRoles || "[]");
    const endpointDescriptions =
      endpoints?.length > 0
        ? endpoints.map((r) => `- ${r.endpoint} (${r.method || "ANY"}) — roles: ${r.roles.join(", ")}`).join("\n")
        : "None provided.";

    // Instruction setup
    const systemInstruction = `
You are ${bot.botName}, a ${bot.botPersona}.
Follow these business rules strictly: ${bot.defaultPrompt}.
Use the knowledge base and available API list to assist the user.
Always respond with a valid JSON object.
`;

    const userPrompt = `
User message: "${userMessage}"

Company knowledge:
${topChunks.map((c, i) => `#${i + 1} ${c.text}`).join("\n\n")}

Available internal API endpoints:
${endpointDescriptions}
`;

    // LLM response schema
    const responseSchema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["none", "call_api"] },
        endpoint: { type: "string", nullable: true },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], nullable: true },
        payload: { type: "object", nullable: true, additionalProperties: true },
        answer: { type: "string" },
      },
      required: ["action", "answer"],
    };

    // Generate LLM response
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
    let aiJson;
    try {
      aiJson = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ status: "failed", error: "Failed to parse LLM response" });
    }

    let finalAnswer = aiJson.answer || "";

    // Handle API calls suggested by AI
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

      try {
        const proxyResponse = await fetch(`${process.env.BACKEND_URL}/api/proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            botId: bot.botId,
            endpoint,
            method,
            payload,
          }),
        });

        if (!proxyResponse.ok) {
          const errBody = await proxyResponse.text();
          finalAnswer += `\n\n⚠️ API error (${proxyResponse.status}): ${errBody}`;
        } else {
          const proxyResult = await proxyResponse.json();
          finalAnswer += `\n\n✅ Action executed result: ${JSON.stringify(proxyResult.data)}`;
        }
      } catch (error) {
        console.error("Proxy call failed:", error);
        finalAnswer += `\n\n⚠️ The system attempted to call ${endpoint}, but the request failed (${error.message})`;
      }
    }

    // Cache and return
    setCache(cacheKey, finalAnswer);
    return res.status(200).json({ botId: bot.botId, response: finalAnswer, cached: false });
  } catch (err) {
    console.error("❌ Chat endpoint error:", err);
    return res.status(500).json({ status: "failed", error: "Internal server error" });
  }
});

export default router;
