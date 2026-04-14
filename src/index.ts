/**
 * @module
 * Main entry point for the Svakom Sam Neo MCP Server.
 * Handles device discovery, hardware initialization, and tool registration.
 */

import {
  ButtplugClient,
  Device,
  consoleLogger,
  PatternEngine,
  PatternEngineClient,
} from "@zendrex/buttplug.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createPistonTools } from "./tools/piston.js";
import { createVacuumTools } from "./tools/vacuum.js";
import { createComboTools } from "./tools/combo.js";
import { createExtendedOTools } from "./tools/extendedO.js";
import { createInfoTools } from "./tools/info.js";
import { createImportPatternTools } from "./tools/importPattern.js";

import { CONFIG } from "./utils/config.js";
import { debugLog, errorLog } from "./utils/logger.js";
import {
  detectSamNeoVersion,
  initializeHardware,
  stopAll,
} from "./utils/hardware.js";

/**
 * The Model Context Protocol (MCP) server instance.
 * Exposes tools for controlling Svakom Sam Neo hardware.
 */
export const server: McpServer = new McpServer({
  name: "Svakom Samneo (@bitti09 fork)",
  version: CONFIG.VERSION,
});

/**
 * The global PatternEngine instance for dispatching advanced, rhythmic commands.
 */
export let engine: PatternEngine;

function isSamNeoDevice(deviceName: string): boolean {
  const normalizedName = deviceName.toLowerCase();
  const patterns = ["svakom sam neo", "sam neo", "samneo"];
  return patterns.some((pattern) => normalizedName.includes(pattern));
}

async function findSamNeoDevice(
  client: ButtplugClient,
): Promise<Device> {
  // Check existing devices first
  const existingSamNeo = client.devices.find((device) =>
    isSamNeoDevice(device.displayName ?? device.name),
  );

  if (existingSamNeo) {
    debugLog(
      "Main",
      `🎯 Found existing Sam Neo device: ${existingSamNeo.displayName ?? existingSamNeo.name}`,
    );
    return existingSamNeo;
  }

  // Otherwise, scan for a new device
  debugLog("Main", "🔎 Scanning for Sam Neo device...");
  await client.startScanning();

  try {
    const device = await new Promise<Device>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          client.stopScanning();
          reject(
            new Error("Timeout: Sam Neo device not found within 15 seconds."),
          );
        }, 15000);

        client.on("deviceAdded", ({ data: { device } }) => {
          const name = device.displayName ?? device.name;
          debugLog("Main", `📱 Device found: ${name}`);
          if (isSamNeoDevice(name)) {
            debugLog("Main", `🎯 Sam Neo device matched!`);
            clearTimeout(timeout);
            client.stopScanning();
            resolve(device);
          }
        });
      },
    );
    return device;
  } finally {
    await client.stopScanning();
  }
}

async function main() {
  debugLog("Main", `🚀 Starting Svakom Sam Neo MCP Server (v${CONFIG.VERSION})`);
  debugLog("Main", `🔌 Connecting to Buttplug server at ${CONFIG.BUTTPLUG_WS_URL}`);

  const client = new ButtplugClient(CONFIG.BUTTPLUG_WS_URL, {
    logger: CONFIG.DEBUG ? consoleLogger : undefined,
    autoReconnect: true,
    reconnectDelay: 1000,
  });

  // Initialize the PatternEngine right after client creation so tools can bind it
  engine = new PatternEngine(client as unknown as PatternEngineClient);

  try {
    await client.connect();
    debugLog("Main", "✅ Client connected to Buttplug server.");

    const device = await findSamNeoDevice(client);

    // Detect device version
    const deviceVersion = detectSamNeoVersion(device);

    // Initialize hardware cache for optimized command routing (v4)
    initializeHardware(device, deviceVersion);

    // Register tools
    createPistonTools(server, device, deviceVersion);
    createVacuumTools(server, device, deviceVersion);
    createComboTools(server, device, deviceVersion);
    createExtendedOTools(server, device, deviceVersion);
    createInfoTools(server, device, deviceVersion);
    createImportPatternTools(server);

    debugLog("Main", `✅ Connected: ${device.displayName ?? device.name} (${deviceVersion})`);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    debugLog("Main", "📡 MCP Server transport connected.");

    // Graceful shutdown
    const cleanup = async (signal: string) => {
      debugLog("Main", `🛑 Received ${signal}, starting graceful shutdown...`);
      try {
        engine.dispose(); // Cleanup pattern engine loops
        await stopAll(device);
        debugLog("Main", "✅ Hardware stopped.");
        await client.disconnect();
        client.dispose(); // Release event listeners and state
        debugLog("Main", "✅ Buttplug client disconnected & disposed.");
      } catch (e) {
        errorLog("Main", "Error during shutdown cleanup:", e);
      }
      debugLog("Main", "👋 Shutdown complete, exiting.");
      process.exit(0);
    };

    process.on("SIGINT", () => cleanup("SIGINT"));
    process.on("SIGTERM", () => cleanup("SIGTERM"));

    // Robust MCP shutdown: triggered when the client closes the connection
    process.stdin.on("end", () => {
      cleanup("stdin closure");
    });
  } catch (error) {
    errorLog("Main", "Critical error in main loop:", error);
    process.exit(1);
  }
}

import { pathToFileURL } from "url";

/**
 * Main execution loop: only runs if this file is the entry point.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    errorLog("Main", "Unhandled exception:", e);
    process.exit(1);
  });
}
