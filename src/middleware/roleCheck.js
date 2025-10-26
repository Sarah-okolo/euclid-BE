// src/middleware/roleCheck.js

/**
 * Finds the rule for an endpoint from the bot's stored JSON mapping.
 */
function findRuleForEndpoint(bot, endpoint) {
  try {
    const rules = JSON.parse(bot.endpointRoles || "[]");
    return rules.find((r) => r.endpoint === endpoint) || null;
  } catch {
    return null;
  }
}

/**
 * Ensures the user (from req.user) has at least one of the allowed roles
 * for the provided endpoint. Uses the bot's rolesNamespace claim.
 */
export function requiresRoleForEndpoint() {
  return (req, res, next) => {
    const { bot, user } = req;
    const endpoint = req.body?.endpoint || req.params?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });

    const rule = findRuleForEndpoint(bot, endpoint);
    if (!rule) return next(); // open if no rule is defined

    const rolesNs = bot.rolesNamespace;
    const userRoles = (user?.[rolesNs] || []).map(String);

    const permitted = rule.roles.some((r) => userRoles.includes(String(r)));
    if (!permitted) return res.status(403).json({ error: "Forbidden: insufficient role" });

    return next();
  };
}
