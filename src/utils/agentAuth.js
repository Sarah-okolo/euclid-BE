// src/utils/agentAuth.js
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Verifies a token for agent-initiated requests.
 * This is used when the agent itself calls back to the backend.
 */
export async function verifyAgentRequest(req, bot) {
  const issuer = `https://${bot.authDomain}/`;
  const audience = bot.authAudience;
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) throw new Error("Missing token for agent verification");

  const JWKS = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, JWKS, { issuer, audience });

  return payload;
}
