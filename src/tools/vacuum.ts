import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice, ActuatorType } from "buttplug";
import { SamNeoVersion, type DeviceState } from "../main.js";

// Helper function for Sam Neo 2 Pro vacuum control
async function executeNeo2VacuumControl(
  device: ButtplugClientDevice,
  intensity: number,
): Promise<string> {
  // Log device capabilities for debugging
  console.error(
    `[VacuumTool] Device capabilities: ${JSON.stringify(device.messageAttributes)}`,
  );
  console.error(`[VacuumTool] Device name: ${device.name}`);
  console.error(
    `[VacuumTool] Available actuator types:`,
    Object.keys(device.messageAttributes),
  );

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

  for (const [index, approach] of approaches.entries()) {
    try {
      console.error(`[VacuumTool] Trying approach ${index + 1}...`);
      const result = await approach();
      console.error(`[VacuumTool] Success with approach: ${result}`);
      return result;
    } catch (error) {
      console.error(`[VacuumTool] Approach ${index + 1} failed: ${error}`);
      continue;
    }
  }

  throw new Error("All Neo2 vacuum control approaches failed");
}

// Helper function for Original Sam Neo vacuum control
async function executeOriginalVacuumControl(
  device: ButtplugClientDevice,
  intensity: number,
): Promise<string> {
  try {
    // Original Sam Neo: Use second vibrator for vacuum/intensity control
    await device.vibrate([0, intensity]); // First vibrator off, second for vacuum
    console.error(
      `[VacuumTool] Original Sam Neo vacuum control: intensity=${intensity}`,
    );
    return "OriginalVibrate";
  } catch (error) {
    console.error(`[VacuumTool] Original vacuum control failed: ${error}`);
    throw new Error("Original Sam Neo vacuum control failed");
  }
}

async function runVacuumOperation(
  deviceState: DeviceState,
  intensity: number,
  duration: number,
  pattern: "constant" | "pulse" | "wave",
  pulseInterval: number,
): Promise<void> {
  const device = deviceState.device;
  const deviceVersion = deviceState.version;
  if (!device || !deviceVersion) return;

  console.error(
    `[VacuumTool] Starting vacuum: intensity=${intensity}, duration=${duration}ms, pattern=${pattern}, device=${deviceVersion}`,
  );

  let successfulApproach = "";

  // Select appropriate vacuum control function based on device version
  const executeVacuumControl =
    deviceVersion === SamNeoVersion.ORIGINAL
      ? executeOriginalVacuumControl
      : executeNeo2VacuumControl;

  if (pattern === "constant") {
    successfulApproach = await executeVacuumControl(device, intensity);
    await new Promise((resolve) => setTimeout(resolve, duration));
  } else if (pattern === "pulse") {
    const cycles = Math.floor(duration / (pulseInterval * 2));
    for (let i = 0; i < cycles; i++) {
      successfulApproach = await executeVacuumControl(device, intensity);
      await new Promise((resolve) => setTimeout(resolve, pulseInterval));
      await executeVacuumControl(device, 0);
      await new Promise((resolve) => setTimeout(resolve, pulseInterval));
    }
  } else if (pattern === "wave") {
    const steps = 20;
    const stepDuration = duration / (steps * 2);

    for (let i = 0; i <= steps; i++) {
      const currentIntensity = (i / steps) * intensity;
      successfulApproach = await executeVacuumControl(device, currentIntensity);
      await new Promise((resolve) => setTimeout(resolve, stepDuration));
    }

    for (let i = steps; i >= 0; i--) {
      const currentIntensity = (i / steps) * intensity;
      await executeVacuumControl(device, currentIntensity);
      await new Promise((resolve) => setTimeout(resolve, stepDuration));
    }
  }

  // Stop vacuum
  await executeVacuumControl(device, 0);

  console.error(
    `[VacuumTool] Completed: intensity=${intensity}, duration=${duration}ms, pattern=${pattern}, approach=${successfulApproach}, device=${deviceVersion}`,
  );
}

export function createVacuumTools(server: McpServer, deviceState: DeviceState) {
  server.tool(
    "Svakom-Sam-Neo-Vacuum",
    "A tool for controlling the vacuum/suction functionality of the Svakom Sam Neo. This tool allows precise control over the suction intensity and patterns for enhanced stimulation.",
    {
      intensity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe(
          "Vacuum intensity level (0.0 to 1.0) - controls the suction power",
        ),
      duration: z
        .number()
        .min(100)
        .max(30000)
        .default(1000)
        .describe("Duration in milliseconds for the vacuum effect"),
      pattern: z
        .enum(["constant", "pulse", "wave"])
        .default("constant")
        .describe(
          "Vacuum pattern: constant (steady), pulse (on/off), wave (gradual changes)",
        ),
      pulseInterval: z
        .number()
        .min(100)
        .max(2000)
        .default(500)
        .optional()
        .describe(
          "Interval in milliseconds for pulse pattern (only used with pulse pattern)",
        ),
    },

    async ({ intensity, duration, pattern, pulseInterval = 500 }) => {
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
      runVacuumOperation(
        deviceState,
        intensity,
        duration,
        pattern,
        pulseInterval,
      ).catch((e) => {
        console.error(`[VacuumTool] Background operation error: ${e}`);
        console.error(
          `[VacuumTool] Device capabilities were:`,
          JSON.stringify(deviceState.device?.messageAttributes),
        );
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Vacuum operation started in background - intensity: ${intensity}, duration: ${duration}ms, pattern: ${pattern}, device: ${deviceState.version}`,
          },
        ],
      };
    },
  );
}
