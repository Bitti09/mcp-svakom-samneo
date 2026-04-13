/**
 * Centralized logging utility for Svakom Sam Neo MCP Server.
 */

import { CONFIG } from "./config.js";

/**
 * Logs a message to stderr if debug mode is enabled.
 * Standard MCP requires stdout for communication, so all logs must go to stderr.
 */
export function debugLog(source: string, ...args: any[]) {
  if (CONFIG.DEBUG) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${source}]`, ...args);
  }
}

/**
 * Logs an error message to stderr.
 */
export function errorLog(source: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${source}] ERROR:`, ...args);
}
