import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice, ActuatorType } from "buttplug";
import { SamNeoVersion, type DeviceState } from "../main.js";

// Helper function for Sam Neo 2 Pro vacuum control in combo mode
async function executeNeo2ComboVacuumControl(
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
      console.error(`[ComboTool] Vacuum success with approach: ${result}`);
      return result;
    } catch (error) {
      console.error(`[ComboTool] Vacuum approach failed: ${error}`);
      continue;
    }
  }

  throw new Error("All Neo2 combo vacuum control approaches failed");
}

// Helper function for Original Sam Neo combo control
async function executeOriginalComboControl(
  device: ButtplugClientDevice,
  vibrationLevel: number,
  vacuumLevel: number,
): Promise<string> {
  try {
    // Original Sam Neo: vibrator 1 for vibration, vibrator 2 for vacuum
    await device.vibrate([vibrationLevel, vacuumLevel]);
    console.error(
      `[ComboTool] Original combo control: vibration=${vibrationLevel}, vacuum=${vacuumLevel}`,
    );
    return "OriginalCombo";
  } catch (error) {
    console.error(`[ComboTool] Original combo control failed: ${error}`);
    throw new Error("Original Sam Neo combo control failed");
  }
}

export function createComboTools(server: McpServer, deviceState: DeviceState) {
  server.tool(
    "Svakom-Sam-Neo-Combo",
    "A tool for simultaneous control of both vibration and vacuum/suction functionality of the Svakom Sam Neo. This tool allows precise coordination of both stimulation types for enhanced experience.",
    {
      duration: z
        .number()
        .min(1000)
        .max(100000)
        .describe(
          "Total duration in milliseconds for the combined stimulation",
        ),
      steps: z
        .number()
        .min(20)
        .max(1000)
        .default(20)
        .describe("Number of steps for the piston motion pattern"),
      vibrationPower: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Base vibration intensity (0.0 to 1.0)"),
      vacuumIntensity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vacuum/suction intensity (0.0 to 1.0)"),
      syncMode: z
        .enum(["synchronized", "alternating", "independent"])
        .default("synchronized")
        .describe(
          "How vibration and vacuum are coordinated: synchronized (together), alternating (opposite), independent (separate patterns)",
        ),
      vacuumPattern: z
        .enum(["constant", "pulse", "wave"])
        .default("constant")
        .describe("Vacuum pattern when in independent mode"),
    },

    async ({
      duration,
      steps,
      vibrationPower,
      vacuumIntensity,
      syncMode,
      vacuumPattern,
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
          `[ComboTool] Starting combo: duration=${duration}ms, steps=${steps}, vibrationPower=${vibrationPower}, vacuumIntensity=${vacuumIntensity}, syncMode=${syncMode}, device=${deviceVersion}`,
        );

        const diff = 1 / steps;
        const delay = duration / steps;

        if (syncMode === "synchronized") {
          // Both vibration and vacuum follow the same stepping pattern
          for (let i = 0; i < steps; i++) {
            const intensity = diff * i;

            if (deviceVersion === SamNeoVersion.ORIGINAL) {
              // Original Sam Neo: Use combined vibrate API
              await executeOriginalComboControl(
                device,
                intensity * vibrationPower,
                intensity * vacuumIntensity,
              );
            } else {
              // Sam Neo 2 Series (Neo2/Neo2 Pro): Separate control
              await device.scalar([
                {
                  Index: 0,
                  Scalar: intensity * vibrationPower,
                  ActuatorType: ActuatorType.Vibrate,
                },
              ]);

              await executeNeo2ComboVacuumControl(
                device,
                intensity * vacuumIntensity,
              );
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } else if (syncMode === "alternating") {
          // Vibration and vacuum alternate - when one is high, the other is low
          for (let i = 0; i < steps; i++) {
            const intensity = diff * i;
            const vibrationLevel = intensity * vibrationPower;
            const vacuumLevel = (1 - intensity) * vacuumIntensity; // Opposite pattern

            if (deviceVersion === SamNeoVersion.ORIGINAL) {
              // Original Sam Neo: Use combined vibrate API with alternating pattern
              await executeOriginalComboControl(
                device,
                vibrationLevel,
                vacuumLevel,
              );
            } else {
              // Sam Neo 2 Series (Neo2/Neo2 Pro): Separate control with alternating pattern
              await device.scalar([
                {
                  Index: 0,
                  Scalar: vibrationLevel,
                  ActuatorType: ActuatorType.Vibrate,
                },
              ]);

              await executeNeo2ComboVacuumControl(device, vacuumLevel);
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } else if (syncMode === "independent") {
          if (deviceVersion === SamNeoVersion.ORIGINAL) {
            // Original Sam Neo: Cannot truly run independent patterns simultaneously
            // Fall back to synchronized mode with a warning
            console.error(
              `[ComboTool] Warning: Original Sam Neo doesn't support independent mode, using synchronized instead`,
            );
            for (let i = 0; i < steps; i++) {
              const intensity = diff * i;
              const currentVacuum =
                vacuumPattern === "wave"
                  ? Math.sin((i / steps) * Math.PI) * vacuumIntensity
                  : vacuumIntensity;

              await executeOriginalComboControl(
                device,
                intensity * vibrationPower,
                currentVacuum,
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          } else {
            // Sam Neo 2 Series (Neo2/Neo2 Pro): Run vibration stepping and vacuum pattern independently and simultaneously
            const vibrationPromise = (async () => {
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
            })();

            const vacuumPromise = (async () => {
              if (vacuumPattern === "constant") {
                await executeNeo2ComboVacuumControl(device, vacuumIntensity);
                await new Promise((resolve) => setTimeout(resolve, duration));
              } else if (vacuumPattern === "pulse") {
                const pulseInterval = 500; // Fixed pulse interval for combo mode
                const cycles = Math.floor(duration / (pulseInterval * 2));
                for (let i = 0; i < cycles; i++) {
                  await executeNeo2ComboVacuumControl(device, vacuumIntensity);
                  await new Promise((resolve) =>
                    setTimeout(resolve, pulseInterval),
                  );

                  await executeNeo2ComboVacuumControl(device, 0);
                  await new Promise((resolve) =>
                    setTimeout(resolve, pulseInterval),
                  );
                }
              } else if (vacuumPattern === "wave") {
                const waveSteps = 20;
                const stepDuration = duration / (waveSteps * 2);

                // Increase
                for (let i = 0; i <= waveSteps; i++) {
                  const currentIntensity = (i / waveSteps) * vacuumIntensity;
                  await executeNeo2ComboVacuumControl(device, currentIntensity);
                  await new Promise((resolve) =>
                    setTimeout(resolve, stepDuration),
                  );
                }

                // Decrease
                for (let i = waveSteps; i >= 0; i--) {
                  const currentIntensity = (i / waveSteps) * vacuumIntensity;
                  await executeNeo2ComboVacuumControl(device, currentIntensity);
                  await new Promise((resolve) =>
                    setTimeout(resolve, stepDuration),
                  );
                }
              }
            })();

            // Wait for both patterns to complete
            await Promise.all([vibrationPromise, vacuumPromise]);
          }
        }

        // Stop both actuators
        if (deviceVersion === SamNeoVersion.ORIGINAL) {
          // Original Sam Neo: Stop both vibrators
          await device.vibrate([0, 0]);
        } else {
          // Sam Neo 2 Series (Neo2/Neo2 Pro): Stop vibration and vacuum separately
          await device.scalar([
            {
              Index: 0,
              Scalar: 0,
              ActuatorType: ActuatorType.Vibrate,
            },
          ]);

          await executeNeo2ComboVacuumControl(device, 0);
        }

        console.error(
          `[ComboTool] Completed: duration=${duration}ms, steps=${steps}, vibrationPower=${vibrationPower}, vacuumIntensity=${vacuumIntensity}, syncMode=${syncMode}, device=${deviceVersion}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Combo stimulation completed - duration: ${duration}ms, steps: ${steps}, vibration: ${vibrationPower}, vacuum: ${vacuumIntensity}, mode: ${syncMode}, device: ${deviceVersion}`,
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
