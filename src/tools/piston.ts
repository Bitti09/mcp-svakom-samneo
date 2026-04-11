import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActuatorType } from "buttplug";
import { SamNeoVersion, type DeviceState } from "../main.js";

async function runPistonOperation(
  deviceState: DeviceState,
  duration: number,
  steps: number,
  vibrationPower: number,
): Promise<void> {
  const device = deviceState.device;
  const deviceVersion = deviceState.version;
  if (!device || !deviceVersion) return;

  const diff = 1 / steps;
  const delay = duration / steps;

  console.error(`[PistonTool] Device version: ${deviceVersion}`);

  if (deviceVersion === SamNeoVersion.ORIGINAL) {
    for (let i = 0; i < steps; i++) {
      const intensity = diff * i;
      await device.vibrate([vibrationPower, intensity]);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } else {
    for (let i = 0; i < steps; i++) {
      const intensity = diff * i;
      await device.scalar([
        {
          Index: 0,
          Scalar: intensity * vibrationPower,
          ActuatorType: ActuatorType.Vibrate,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  await device.stop();

  console.error(
    `[PistonTool] Completed: duration=${duration}ms, steps=${steps}, vibrationPower=${vibrationPower}, device=${deviceVersion}`,
  );
}

export function createPistonTools(server: McpServer, deviceState: DeviceState) {
  server.tool(
    "Svakom-Sam-Neo-Piston",
    "A tool for operating the Svakom Sam Neo, a device that supports the Buttplug protocol. This tool allows the user to stimulate interactively. This tool allows the user to give piston motion.",
    {
      duration: z
        .number()
        .min(1000)
        .max(100000)
        .describe(
          "Thrust count (duration in ms) — the more frequent the thrusts, the more fervent and passionate the rhythm becomes, like a relentless desire that refuses to fade.",
        ),
      steps: z
        .number()
        .min(20)
        .max(1000)
        .default(20)
        .describe(
          "Number of steps per thrust — the more steps it takes, the more deliberate and indulgently drawn-out each motion becomes, oozing with a sticky, aching rhythm.",
        ),
      vibrationPower: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vibration power."),
    },

    async ({ duration, steps, vibrationPower }) => {
      if (!deviceState.device || !deviceState.version) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No Sam Neo device is connected. Please ensure Intiface/Buttplug is running and your device is paired.",
            },
          ],
        };
      }

      // Run device operation in the background so the AI can continue immediately.
      runPistonOperation(deviceState, duration, steps, vibrationPower).catch(
        (e) => console.error(`[PistonTool] Background operation error: ${e}`),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Piston motion started in background - duration: ${duration}ms, steps: ${steps}, vibrationPower: ${vibrationPower}, device: ${deviceState.version}`,
          },
        ],
      };
    },
  );
}
