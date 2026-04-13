/**
 * Central configuration for the Svakom Sam Neo MCP server.
 */
export const CONFIG = {
  /**
   * When HARD_MODE is true:
   * 1. The 'Anti-Jolt' safety enforcer is disabled (extreme jumps allowed).
   * 2. Tool descriptions omit safety warnings and instructions to use ramps.
   * Toggle via SAM_NEO_HARD_MODE environment variable.
   */
  HARD_MODE: process.env.SAM_NEO_HARD_MODE === "true" || false,
};
