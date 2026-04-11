#!/usr/bin/env node

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

// Sam Neo device version enum
export enum SamNeoVersion {
  ORIGINAL = "original",
  NEO2_SERIES = "neo2_series", // Covers both Neo2 and Neo2 Pro (same capabilities)
}

// Mutable device state shared with tool handlers.
// Tools read this at invocation time, so they work correctly even when a
// device connects or disconnects after the MCP transport is already running.
export interface DeviceState {
  device: ButtplugClientDevice | null;
  version: SamNeoVersion | null;
}

// Detect Sam Neo device version based on capabilities
function detectSamNeoVersion(device: ButtplugClientDevice): SamNeoVersion {
  const scalarCmds = device.messageAttributes.ScalarCmd;

  if (!scalarCmds || !Array.isArray(scalarCmds)) {
    console.error(`⚠️ No ScalarCmd found, defaulting to original Sam Neo`);
    return SamNeoVersion.ORIGINAL;
  }

  // Count ActuatorTypes
  const actuatorTypes = scalarCmds.map((cmd) => cmd.ActuatorType);
  const hasConstrict = actuatorTypes.includes("Constrict" as any);
  const vibrateCount = actuatorTypes.filter(
    (type) => type === "Vibrate",
  ).length;

  console.error(`🔍 Device ActuatorTypes: ${JSON.stringify(actuatorTypes)}`);
  console.error(
    `🔍 Vibrate count: ${vibrateCount}, Has Constrict: ${hasConstrict}`,
  );

  if (hasConstrict && vibrateCount === 1) {
    console.error(
      `✅ Detected: Sam Neo 2 Series (Vibrate + Constrict) - covers Neo2 and Neo2 Pro`,
    );
    return SamNeoVersion.NEO2_SERIES;
  } else if (vibrateCount >= 2) {
    console.error(`✅ Detected: Original Sam Neo (Multiple Vibrators)`);
    return SamNeoVersion.ORIGINAL;
  } else {
    console.error(`⚠️ Unknown configuration, defaulting to original Sam Neo`);
    return SamNeoVersion.ORIGINAL;
  }
}

export const server = new McpServer({
  name: "Svakom Samneo",
  version: "1.0.0",
});

function isSamNeoDevice(deviceName: string): boolean {
  const normalizedName = deviceName.toLowerCase();
  console.error(`🔍 checking device: "${deviceName}" -> "${normalizedName}"`);

  const patterns = ["svakom sam neo", "sam neo", "samneo"];

  const matches = patterns.some((pattern) => normalizedName.includes(pattern));
  console.error(`✨ pattern match result: ${matches}`);

  return matches;
}

// Shared device state – populated asynchronously once a device is found.
const deviceState: DeviceState = { device: null, version: null };

// Register all tools up-front. Each handler reads deviceState at call time.
createPistonTools(server, deviceState);
createVacuumTools(server, deviceState);
createComboTools(server, deviceState);
createExtendedOTools(server, deviceState);

// Background task: connect to Buttplug and discover a Sam Neo device.
// Runs independently from the MCP transport so the server is always available.
async function connectButtplug(): Promise<void> {
  let client: ButtplugClient;

  try {
    client = new ButtplugClient("mcp-svakom-samneo");
    const connector = new ButtplugNodeWebsocketClientConnector(
      "ws://localhost:12345",
    );
    await client.connect(connector);
  } catch (e) {
    console.error(
      `⚠️ Could not connect to Buttplug server (ws://localhost:12345): ${e}`,
    );
    console.error(
      `⚠️ Device tools will return errors until a device is connected.`,
    );
    return;
  }

  // Register a persistent deviceadded listener so late connections always work.
  // activateDevice is idempotent: re-connecting the same device simply
  // refreshes deviceState, which is safe in JS's single-threaded event loop.
  client.on("deviceadded", (d) => {
    console.error(`📱 device found: ${d.name}`);
    if (isSamNeoDevice(d.name)) {
      console.error(`🎯 Sam Neo device matched!`);
      activateDevice(d);
    } else {
      console.error(`❌ Device not a Sam Neo variant, continuing scan…`);
    }
  });

  // Clear device state when a device is removed
  client.on("deviceremoved", (d) => {
    if (deviceState.device && deviceState.device.index === d.index) {
      console.error(`📴 Sam Neo device disconnected: ${d.name}`);
      deviceState.device = null;
      deviceState.version = null;
    }
  });

  console.error("🔎 scanning…");
  try {
    await client.startScanning();
  } catch (e) {
    console.error(`⚠️ Failed to start scanning: ${e}`);
  }

  // Log existing devices
  const existingDevices = client.devices;
  console.error(`📋 existing devices: ${existingDevices.length}`);
  existingDevices.forEach((device) => {
    console.error(`  - ${device.name}`);
  });

  // Check if Sam Neo device already exists
  const existingSamNeo = existingDevices.find((device) =>
    isSamNeoDevice(device.name),
  );

  if (existingSamNeo) {
    console.error(`🎯 Found existing Sam Neo device: ${existingSamNeo.name}`);
    activateDevice(existingSamNeo);
    return;
  }

  // Wait up to 15 s for an initial device connection, then return so the
  // background task ends. The persistent deviceadded listener above keeps
  // handling future connections for the lifetime of the process.
  console.error(`⏳ Waiting for Sam Neo device (15 s timeout)…`);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.error(
        `⚠️ Sam Neo device not found within 15 s. Tools will return errors until a device connects.`,
      );
      resolve();
    }, 15000);

    // Resolve early when a matching device arrives during the wait window.
    const earlyResolve = () => {
      if (deviceState.device) {
        clearTimeout(timer);
        resolve();
      }
    };
    client.on("deviceadded", earlyResolve);
  });
}

function activateDevice(device: ButtplugClientDevice): void {
  // Log device capabilities for debugging
  console.error(`🔧 Device capabilities for ${device.name}:`);
  console.error(`  Messages: ${JSON.stringify(device.messageAttributes)}`);

  const version = detectSamNeoVersion(device);
  console.error(`🎯 Device version: ${version}`);

  deviceState.device = device;
  deviceState.version = version;
  console.error(`✅ connected: ${device.name} (${version})`);
}

async function main() {
  // Start the MCP stdio transport immediately – the AI can now communicate.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Kick off device discovery in the background without blocking the server.
  connectButtplug().catch((e) => {
    console.error(`⚠️ Background device connection error: ${e}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
