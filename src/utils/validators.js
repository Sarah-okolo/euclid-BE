// src/utils/validators.js

/**
 * Validates bot configuration payload before saving
 * @param {object} data
 * @param {object} [options] - optional settings, e.g. { update: true }
 * @returns {string|null} error message or null if valid
 */
export function validateBotConfig(data, options = {}) {
  // Required fields for creation
  const requiredFields = [
    "botName",
    "botPersona",
    "businessName",
    "defaultPrompt",
    "apiBaseUrl",
    "authDomain",
    "authAudience",
  ];

  // If we're validating a new bot (not an update)
  if (!options.update) {
    for (const field of requiredFields) {
      if (!data[field] || String(data[field]).trim() === "") {
        return `Missing required field: ${field}`;
      }
    }
  }

  // No validation error
  return null;
}
