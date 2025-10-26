// src/routes/proxy.js
import express from "express";
import fetch from "node-fetch";
import { authz } from "../middleware/authz.js";
import { requiresRoleForEndpoint } from "../middleware/roleCheck.js";

const router = express.Router();

/**
 * POST /api/proxy
 * Securely forwards requests to the SaaS application's API on behalf of the user.
 * Requires: botId, endpoint, method, (optional) payload.
 * Auth token can be in Authorization header (preferred) or body.userToken (legacy).
 */
router.post("/", authz(), requiresRoleForEndpoint(), async (req, res) => {
  try {
    const { endpoint, method = "GET", payload } = req.body;
    const { bot, token } = req;

    if (!endpoint) {
      return res.status(400).json({ status: "failed", error: "Missing endpoint" });
    }

    const targetUrl = `${bot.apiBaseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      // Forward the user's token to the first-party API (on-behalf-of the user)
      Authorization: `Bearer ${token}`,
    };

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: method.toUpperCase() !== "GET" ? JSON.stringify(payload || {}) : undefined,
    });

    const isJson = upstream.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await upstream.json() : await upstream.text();

    return res.json({ status: "success", data, httpStatus: upstream.status });
  } catch (err) {
    console.error("❌ Proxy error:", err);
    return res.status(500).json({ status: "failed", error: "Proxy request failed" });
  }
});

export default router;
