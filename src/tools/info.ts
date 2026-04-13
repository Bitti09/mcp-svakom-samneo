import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Device } from "@zendrex/buttplug.js";
import { type SamNeoVersion, deviceState } from "../utils/hardware.js";
import { errorLog } from "../utils/logger.js";
import { listPatterns } from "../utils/patternRegistry.js";

/**
 * Registers informational tools with the MCP server.
 * Provides battery status, connection diagnostics, and state summaries.
 */
export function createInfoTools(
  server: McpServer,
  device: Device,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-DeviceInfo",
    "Retrieves operational info about the connected Svakom Sam Neo (battery level, hardware specs, and connection status). AI AGENTS: Use this tool regularly to maintain state-awareness, check current intensities, and verify device capabilities before sending commands.",
    async () => {
      try {
        const hasBattery = device.canRead("Battery");
        let batteryLevel = -1;
        if (hasBattery) {
          try {
            batteryLevel = await device.readSensor("Battery");
          } catch {
            // Ignore error if battery read fails
          }
        }

        const interpretationLines: string[] = [];
        const outputs: string[] = [];
        
        if (device.canOutput("Vibrate")) {
          outputs.push("Vibrate");
          interpretationLines.push(`Device supports Vibration`);
        }
        if (device.canOutput("Constrict")) {
          outputs.push("Constrict");
          interpretationLines.push(`Device supports Constriction/Suction`);
        }

        const info = {
          name: device.name,
          displayName: device.displayName,
          index: device.index,
          version: deviceVersion,
          supportedOutputs: outputs,
          battery: {
            hasBattery,
            level: batteryLevel,
          },
          lastSetIntensity: {
            vibration: deviceState.lastVibration,
            vacuum: deviceState.lastVacuum,
          },
          ai_interpretation: {
            layout: interpretationLines,
            battery_note: hasBattery
              ? "Battery polling enabled"
              : "Battery reporting not supported by this hardware",
            conclusion: `Hardware recognized. Outputs supported: ${outputs.join(", ")}.`,
          },
          availableCustomPatterns: listPatterns(),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (e) {
        errorLog("InfoTool", "Error retrieving device info:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving device info: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "Svakom-Sam-Neo-DeviceDebug",
    "Returns the complete raw device configuration for debugging. AI AGENTS: Only use this if DeviceInfo returns unexpected results or hardware identification is failing.",
    async () => {
      try {
        // With Zendrex, we summarize the basic capabilities since raw features are abstracted
        const debugData = {
          name: device.name,
          displayName: device.displayName,
          index: device.index,
          capabilities: {
            outputs: {
              Vibrate: device.canOutput("Vibrate"),
              Rotate: device.canOutput("Rotate"),
              Constrict: device.canOutput("Constrict"),
              Oscillate: device.canOutput("Oscillate"),
            },
            inputs: {
              Battery: device.canRead("Battery"),
              Button: device.canRead("Button"),
              RSSI: device.canRead("RSSI"),
            }
          }
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(debugData, null, 2),
            },
          ],
        };
      } catch (e) {
        errorLog("InfoTool", "Error retrieving debug info:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving debug info: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
