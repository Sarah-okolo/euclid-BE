// src/routes/proxy.js
import express from "express";
import fetch from "node-fetch";
import { authz } from "../middleware/authz.js";
import { requiresRoleForEndpoint } from "../middleware/roleCheck.js";

const router = express.Router();

/**
 * POST /api/proxy
 * Securely forwards requests to the SaaS application's first-party API on behalf of the user.
 * Requires: botId, endpoint, method, (optional) payload.
 * Validates Auth0 access token via middleware.
 */
router.post("/", authz(), requiresRoleForEndpoint(), async (req, res) => {
  try {
    const { endpoint, method = "GET", payload } = req.body;
    const { bot, token, user } = req;

    if (!endpoint) {
      return res.status(400).json({ status: "failed", error: "Missing endpoint" });
    }

    // Defense in depth: ensure the verified token audience matches this bot's API audience.
    const audClaim = Array.isArray(user?.aud) ? user.aud : [user?.aud].filter(Boolean);
    const audOk = audClaim.includes(bot.authAudience);
    if (!audOk) {
      return res.status(401).json({
        status: "failed",
        error: "Access token audience does not match API audience for this bot.",
      });
    }

    // Construct target URL (first-party API)
    const targetUrl = `${bot.apiBaseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`, // user’s Auth0 access token (audience validated)
      "X-Agent-User": user?.sub || "unknown",
    };

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: method.toUpperCase() !== "GET" ? JSON.stringify(payload || {}) : undefined,
    });

    const isJson = upstream.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await upstream.json() : await upstream.text();

    return res.json({
      status: "success",
      data,
      httpStatus: upstream.status,
    });
  } catch (err) {
    console.error("❌ Proxy error:", err);
    return res.status(500).json({ status: "failed", error: "Proxy request failed" });
  }
});

export default router;
