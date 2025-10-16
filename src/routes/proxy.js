// src/routes/proxy.js
import express from "express";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { getDB } from "../config/db.js";

const router = express.Router();

/**
 * Fetch the Auth0 public key dynamically for signature verification
 */
async function getSigningKey(domain, kid) {
  const client = jwksClient({
    jwksUri: `https://${domain}/.well-known/jwks.json`,
  });
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

/**
 * POST /api/proxy
 * Allows the AI agent to securely call business APIs on behalf of an authenticated user
 */
router.post("/", async (req, res) => {
  try {
    const { botId, endpoint, method = "GET", payload, userToken } = req.body;

    if (!botId || !endpoint || !userToken) {
      return res
        .status(400)
        .json({ status: "failed", error: "Missing botId, endpoint, or userToken" });
    }

    const db = getDB();
    const botsCollection = db.collection("bots");
    const bot = await botsCollection.findOne({ botId });

    if (!bot) {
      return res.status(404).json({ status: "failed", error: "Bot not found" });
    }

    // Step 1: Verify JWT signature using Auth0 JWKS
    let decoded;
    try {
      const decodedHeader = jwt.decode(userToken, { complete: true });
      const signingKey = await getSigningKey(bot.authDomain, decodedHeader.header.kid);
      decoded = jwt.verify(userToken, signingKey, {
        audience: bot.authAudience,
        issuer: `https://${bot.authDomain}/`,
        algorithms: ["RS256"],
      });
    } catch (err) {
      console.error("JWT verification failed:", err);
      return res.status(401).json({ status: "failed", error: "Invalid user token" });
    }

    // Step 2: Verify user’s role permissions for the endpoint
    const userRoles = decoded[bot.rolesNamespace] || [];
    const endpointRules = JSON.parse(bot.endpointRoles || "[]");
    const rule = endpointRules.find((r) => r.endpoint === endpoint);

    if (rule && !rule.roles.some((role) => userRoles.includes(role))) {
      return res
        .status(403)
        .json({ status: "failed", error: "User not authorized for this endpoint" });
    }

    // Step 3: Forward the request to the target business API
    const targetUrl = `${bot.apiBaseUrl}${endpoint}`;
    const response = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: method !== "GET" ? JSON.stringify(payload || {}) : undefined,
    });

    const data = await response.json();

    return res.json({
      status: "success",
      data,
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ status: "failed", error: "Proxy request failed" });
  }
});

export default router;
