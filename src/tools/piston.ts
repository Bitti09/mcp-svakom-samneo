import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActuatorType } from "buttplug";
import { SamNeoVersion, type DeviceState } from "../main.js";

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
      try {
        const device = deviceState.device;
        const deviceVersion = deviceState.version;
        if (!device || !deviceVersion) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No Sam Neo device is connected. Please ensure Intiface/Buttplug is running and your device is paired.",
              },
            ],
          };
        }
        const diff = 1 / steps;
        const delay = duration / steps;

        console.error(`[PistonTool] Device version: ${deviceVersion}`);

        if (deviceVersion === SamNeoVersion.ORIGINAL) {
          // Original Sam Neo: Use old vibrate API with 2 vibrators
          for (let i = 0; i < steps; i++) {
            const intensity = diff * i;
            // vibrationPower controls base vibration, intensity controls piston motion
            await device.vibrate([vibrationPower, intensity]);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } else {
          // Sam Neo 2 Series (Neo2/Neo2 Pro): Use scalar API with single vibrator
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
        return {
          content: [
            {
              type: "text",
              text: `Piston motion completed - duration: ${duration}ms, steps: ${steps}, vibrationPower: ${vibrationPower}, device: ${deviceVersion}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${e}`,
            },
          ],
        };
      }
    },
  );
}
