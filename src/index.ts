/**
 * @module
 * Main entry point for the Svakom Sam Neo MCP Server.
 * Handles device discovery, hardware initialization, and tool registration.
 */

import {
  ButtplugClient,
  ButtplugNodeWebsocketClientConnector,
  ButtplugClientDevice,
} from "buttplug";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createPistonTools } from "./tools/piston.js";
import { createVacuumTools } from "./tools/vacuum.js";
import { createComboTools } from "./tools/combo.js";
import { createExtendedOTools } from "./tools/extendedO.js";
import { createInfoTools } from "./tools/info.js";

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
export const server = new McpServer({
  name: "Svakom Samneo (@bitti09 fork)",
  version: "1.1.0",
});

function isSamNeoDevice(deviceName: string): boolean {
  const normalizedName = deviceName.toLowerCase();
  const patterns = ["svakom sam neo", "sam neo", "samneo"];
  return patterns.some((pattern) => normalizedName.includes(pattern));
}

async function findSamNeoDevice(
  client: ButtplugClient,
): Promise<ButtplugClientDevice> {
  // Check existing devices first
  const existingDevices = Array.from(client.devices.values());
  const existingSamNeo = existingDevices.find((device) =>
    isSamNeoDevice(device.name),
  );

  if (existingSamNeo) {
    debugLog(
      "Main",
      `🎯 Found existing Sam Neo device: ${existingSamNeo.name}`,
    );
    return existingSamNeo;
  }

  // Otherwise, scan for a new device
  debugLog("Main", "🔎 Scanning for Sam Neo device...");
  await client.startScanning();

  try {
    const device = await new Promise<ButtplugClientDevice>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          client.stopScanning();
          reject(
            new Error("Timeout: Sam Neo device not found within 15 seconds."),
          );
        }, 15000);

        client.on("deviceadded", (d) => {
          debugLog("Main", `📱 Device found: ${d.name}`);
          if (isSamNeoDevice(d.name)) {
            debugLog("Main", `🎯 Sam Neo device matched!`);
            clearTimeout(timeout);
            client.stopScanning();
            resolve(d);
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
  debugLog("Main", `🚀 Starting Svakom Sam Neo MCP Server (v1.1.0)`);
  debugLog("Main", `🔌 Connecting to Buttplug server at ${BUTTPLUG_WS_URL}`);

  const client = new ButtplugClient("mcp-svakom-samneo");
  const connector = new ButtplugNodeWebsocketClientConnector(BUTTPLUG_WS_URL);

  try {
    await client.connect(connector);
    debugLog("Main", "✅ Client connected to Buttplug server.");

    // Ensure the client's internal device map is populated
    await (client as any).requestDeviceList();

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

    debugLog("Main", `✅ Connected: ${device.name} (${deviceVersion})`);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    debugLog("Main", "📡 MCP Server transport connected.");

    // Graceful shutdown
    const cleanup = async (signal: string) => {
      debugLog("Main", `🛑 Received ${signal}, starting graceful shutdown...`);
      try {
        await stopAll(device);
        debugLog("Main", "✅ Hardware stopped.");
        await client.disconnect();
        debugLog("Main", "✅ Buttplug client disconnected.");
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

main().catch((e) => {
  errorLog("Main", "Unhandled exception:", e);
  process.exit(1);
});
