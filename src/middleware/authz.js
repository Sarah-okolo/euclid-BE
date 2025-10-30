// src/middleware/authz.js
import { getDB } from "../config/db.js";
import { getTokenFromRequest, verifyAccessToken } from "../config/auth0.js";

/**
 * Loads the bot by :botId or body.botId and verifies the user's access token
 * against that bot's Auth0 domain/audience.
 * Attaches req.bot, req.user, req.token for downstream handlers.
 */
export function authz() {
  return async (req, res, next) => {
    try {
      const db = getDB();
      const botId = req.params?.botId || req.body?.botId;
      if (!botId) return res.status(400).json({ error: "Missing botId" });

      const bot = await db.collection("bots").findOne({ botId });
      if (!bot) return res.status(404).json({ error: "Bot not found" });

      const token = getTokenFromRequest(req);
      if (!token) return res.status(401).json({ error: "No access token provided" });

      const issuer = `https://${bot.authDomain}/`;
      const audience = bot.authAudience;

      // Verify access token via JOSE
      const payload = await verifyAccessToken(token, { issuer, audience });

      req.bot = bot;
      req.user = payload;
      req.token = token;

      next();
    } catch (err) {
      console.error("❌ authz middleware error:", err);
      return res.status(401).json({ error: "Invalid or expired access token" });
    }
  };
}
