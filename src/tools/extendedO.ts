import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice, ActuatorType } from "buttplug";
import { SamNeoVersion, type DeviceState } from "../main.js";

// Helper function for Sam Neo 2 vacuum control (reused from vacuum.ts)
async function executeNeo2VacuumControl(
  device: ButtplugClientDevice,
  intensity: number,
): Promise<string> {
  const approaches = [
    // Approach 1: Try Constrict ActuatorType (most likely for vacuum/suction)
    async () => {
      await device.scalar([
        {
          Index: 1, // Constrict uses Index 1 based on device capabilities
          Scalar: intensity,
          ActuatorType: "Constrict" as any, // Try as string first
        },
      ]);
      return "Constrict";
    },

    // Approach 2: Try LinearCmd for position-based control
    async () => {
      await device.linear([[intensity, 100]]);
      return "Linear";
    },

    // Approach 3: Try different Index with Inflate
    async () => {
      await device.scalar([
        {
          Index: 1,
          Scalar: intensity,
          ActuatorType: ActuatorType.Inflate,
        },
      ]);
      return "Inflate-Index1";
    },

    // Approach 4: Original Inflate approach (as fallback)
    async () => {
      await device.scalar([
        {
          Index: 0,
          Scalar: intensity,
          ActuatorType: ActuatorType.Inflate,
        },
      ]);
      return "Inflate-Index0";
    },
  ];

  for (const approach of approaches) {
    try {
      const result = await approach();
      console.error(
        `[ExtendedO] Vacuum control success with approach: ${result}`,
      );
      return result;
    } catch (error) {
      console.error(`[ExtendedO] Vacuum approach failed: ${error}`);
      continue;
    }
  }

  throw new Error("All Neo2 vacuum control approaches failed");
}

export function createExtendedOTools(
  server: McpServer,
  deviceState: DeviceState,
) {
  server.tool(
    "Svakom-Sam-Neo-ExtendedO",
    "Extended O mode for Svakom Sam Neo 2 - A special function that instantly reduces both vibration and suction to their lowest intensity to prolong and intensify climax. This simulates the device's Extended O feature which helps manage ejaculation control by lowering intensity at the critical moment.",
    {
      currentVibration: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Current vibration intensity (0.0 to 1.0) that will be reduced",
        ),
      currentVacuum: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Current vacuum/suction intensity (0.0 to 1.0) that will be reduced",
        ),
      holdDuration: z
        .number()
        .min(1000)
        .max(60000)
        .default(10000)
        .describe("Duration in milliseconds to hold the reduced intensity"),
      minimumLevel: z
        .number()
        .min(0)
        .max(0.3)
        .default(0.1)
        .describe("Minimum intensity level during Extended O (default: 0.1)"),
      restoreDuration: z
        .number()
        .min(0)
        .max(5000)
        .default(500)
        .describe(
          "Duration in milliseconds to restore to original intensity (0 for instant)",
        ),
    },

    async ({
      currentVibration,
      currentVacuum,
      holdDuration,
      minimumLevel,
      restoreDuration,
    }) => {
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
        console.error(
          `[ExtendedO] Starting Extended O mode: currentVibration=${currentVibration}, currentVacuum=${currentVacuum}, holdDuration=${holdDuration}ms, minimumLevel=${minimumLevel}, device=${deviceVersion}`,
        );

        // Step 1: Immediately reduce both vibration and vacuum to minimum level
        if (deviceVersion === SamNeoVersion.ORIGINAL) {
          // Original Sam Neo: Use combined vibrate API
          await device.vibrate([minimumLevel, minimumLevel]);
          console.error(
            `[ExtendedO] Original Sam Neo reduced to minimum: ${minimumLevel}`,
          );
        } else {
          // Sam Neo 2 Series: Separate control
          // Reduce vibration
          await device.scalar([
            {
              Index: 0,
              Scalar: minimumLevel,
              ActuatorType: ActuatorType.Vibrate,
            },
          ]);

          // Reduce vacuum
          await executeNeo2VacuumControl(device, minimumLevel);
          console.error(
            `[ExtendedO] Neo2 Series reduced to minimum: ${minimumLevel}`,
          );
        }

        // Step 2: Hold at minimum level for specified duration
        console.error(
          `[ExtendedO] Holding at minimum level for ${holdDuration}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, holdDuration));

        // Step 3: Restore to original intensity
        if (restoreDuration === 0) {
          // Instant restore
          if (deviceVersion === SamNeoVersion.ORIGINAL) {
            await device.vibrate([currentVibration, currentVacuum]);
          } else {
            await device.scalar([
              {
                Index: 0,
                Scalar: currentVibration,
                ActuatorType: ActuatorType.Vibrate,
              },
            ]);
            await executeNeo2VacuumControl(device, currentVacuum);
          }
          console.error(`[ExtendedO] Instantly restored to original levels`);
        } else {
          // Gradual restore
          const steps = 10;
          const stepDelay = restoreDuration / steps;
          const vibrationStep = (currentVibration - minimumLevel) / steps;
          const vacuumStep = (currentVacuum - minimumLevel) / steps;

          for (let i = 1; i <= steps; i++) {
            const vibrationLevel = minimumLevel + vibrationStep * i;
            const vacuumLevel = minimumLevel + vacuumStep * i;

            if (deviceVersion === SamNeoVersion.ORIGINAL) {
              await device.vibrate([vibrationLevel, vacuumLevel]);
            } else {
              await device.scalar([
                {
                  Index: 0,
                  Scalar: vibrationLevel,
                  ActuatorType: ActuatorType.Vibrate,
                },
              ]);
              await executeNeo2VacuumControl(device, vacuumLevel);
            }

            await new Promise((resolve) => setTimeout(resolve, stepDelay));
          }
          console.error(
            `[ExtendedO] Gradually restored to original levels over ${restoreDuration}ms`,
          );
        }

        console.error(
          `[ExtendedO] Extended O mode completed - device: ${deviceVersion}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Extended O completed - held at ${minimumLevel} for ${holdDuration}ms, restored to vibration: ${currentVibration}, vacuum: ${currentVacuum}, device: ${deviceVersion}`,
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
