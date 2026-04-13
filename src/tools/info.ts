import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ButtplugClientDevice, InputType, OutputType } from "buttplug";
import { type SamNeoVersion, deviceState } from "../utils/hardware.js";
import { errorLog } from "../utils/logger.js";

/**
 * Registers informational tools with the MCP server.
 * Provides battery status, connection diagnostics, and state summaries.
 */
export function createInfoTools(
  server: McpServer,
  device: ButtplugClientDevice,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-DeviceInfo",
    "Retrieves operational info about the connected Svakom Sam Neo (battery level, hardware specs, and connection status). AI AGENTS: Use this tool regularly to maintain state-awareness, check current intensities, and verify device capabilities before sending commands.",
    async () => {
      try {
        const hasBattery = device.hasInput(InputType.Battery);
        let batteryLevel = -1;
        if (hasBattery) {
          try {
            batteryLevel = await device.battery();
          } catch (_e) {
            // Ignore error if battery read fails
          }
        }

        const interpretationLines: string[] = [];
        const featuresSummary: Record<number, { outputs: string[] }> = {};

        for (const [index, feature] of device.features.entries()) {
          const outputs: string[] = [];
          if (feature.hasOutput(OutputType.Vibrate)) {
            outputs.push("Vibrate");
            interpretationLines.push(`Feature ${index} is a Vibrator`);
          }
          if (feature.hasOutput(OutputType.Constrict)) {
            outputs.push("Constrict");
            interpretationLines.push(
              `Feature ${index} is a Constrictor/Suction`,
            );
          }
          featuresSummary[index] = { outputs };
        }

        const info = {
          name: device.name,
          displayName: device.displayName,
          index: device.index,
          version: deviceVersion,
          features: featuresSummary,
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
            conclusion: `Hardware recognized. Discovery confirmed ${
              Object.keys(featuresSummary).length
            } features.`,
          },
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
        const features: any[] = [];
        for (const [index, feature] of device.features.entries()) {
          features.push({
            index,
            supportedOutputs: Object.values(OutputType).filter(
              (t) => typeof t === "string" && feature.hasOutput(t as any),
            ),
            supportedInputs: Object.values(InputType).filter(
              (t) => typeof t === "string" && feature.hasInput(t as any),
            ),
          });
        }

        const debugData = {
          name: device.name,
          displayName: device.displayName,
          index: device.index,
          messageTimingGap: device.messageTimingGap,
          v4_features: features,
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
