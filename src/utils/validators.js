// src/utils/validators.js

/**
 * Validates bot configuration payload before saving
 * @param {object} data
 * @returns {string|null} error message or null if valid
 */
export function validateBotConfig(data) {
  const requiredFields = [
    "botName",
    "botPersona",
    "businessName",
    "defaultPrompt",
    "apiBaseUrl",
    "authDomain",
    "authAudience",
    "rolesNamespace",
  ];

  for (const field of requiredFields) {
    if (!data[field] || String(data[field]).trim() === "") {
      return `Missing required field: ${field}`;
    }
  }

  return null;
}
