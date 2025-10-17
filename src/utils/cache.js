// src/utils/cache.js

// Simple in-memory cache (per instance)
const cache = new Map();

// Default TTL = 10 minutes
const DEFAULT_TTL = 10 * 60 * 1000;

export function setCache(key, value, ttl = DEFAULT_TTL) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttl,
  });
}

export function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function clearCache(key) {
  cache.delete(key);
}

export function flushCache() {
  cache.clear();
}
