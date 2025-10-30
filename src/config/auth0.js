// src/config/auth0.js
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Extract a Bearer token from either the Authorization header
 * or (for backward compatibility) req.body.userToken.
 */
export function getTokenFromRequest(req) {
  const hdr = req.headers.authorization || "";
  const headerToken = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : null;
  const bodyToken = req.body?.userToken || null;
  return headerToken || bodyToken || null;
}

/**
 * Verify an Auth0 access token using remote JWKS.
 * Uses JOSE to validate tokens issued by the bot’s Auth0 tenant.
 */
export async function verifyAccessToken(token, { issuer, audience }) {
  if (!token) throw new Error("Missing access token");

  const iss = issuer.endsWith("/") ? issuer : `${issuer}/`;
  const JWKS = createRemoteJWKSet(new URL(`${iss}.well-known/jwks.json`));

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: iss,
    audience,
  });

  return payload;
}
