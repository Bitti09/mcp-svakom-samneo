/**
 * Central configuration for the Svakom Sam Neo MCP server.
 */
export const CONFIG = {
  /**
   * The version of the MCP Server (Sync with package.json)
   */
  VERSION: "1.3.0",

  /**
   * When HARD_MODE is true:
   * 1. The 'Anti-Jolt' safety enforcer is disabled (extreme jumps allowed).
   * 2. Tool descriptions omit safety warnings and instructions to use ramps.
   * Toggle via SAM_NEO_HARD_MODE environment variable.
   */
  HARD_MODE: process.env.SAM_NEO_HARD_MODE === "true" || false,

  /**
   * The WebSocket URL for the Buttplug server.
   * Defaults to ws://localhost:12346.
   */
  BUTTPLUG_WS_URL:
    process.env.BUTTPLUG_WS_URL || "ws://localhost:12346",

  /**
   * Flag indicating whether diagnostic debug logging is enabled.
   * Controlled by the DEBUG environment variable.
   */
  DEBUG: process.env.DEBUG === "true" || process.env.DEBUG === undefined,
};
