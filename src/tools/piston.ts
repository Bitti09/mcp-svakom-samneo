import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice } from "buttplug";
import {
  type SamNeoVersion,
  deviceState,
  setVibration,
  setVacuum,
  stopAll,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVibration, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";

export function createPistonTools(
  server: McpServer,
  device: ButtplugClientDevice,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-Piston",
    `A tool for operating the Svakom Sam Neo's piston-like vibration motion.${
      CONFIG.HARD_MODE
        ? ""
        : " AI AGENTS: Intensity jumps >70% from stop are prohibited; use ramps."
    } Returns current device state.`,
    {
      duration: z
        .number()
        .min(1000)
        .max(100000)
        .describe("Total duration of the movement in milliseconds."),
      steps: z
        .number()
        .min(20)
        .max(1000)
        .default(20)
        .describe("Number of intensity steps per cycle."),
      vibrationPower: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Base vibration intensity (0.0 to 1.0)."),
    },

    async ({ duration, steps, vibrationPower }) => {
      debugLog(
        "PistonTool",
        `Starting piston motion: duration=${duration}ms, steps=${steps}, power=${vibrationPower}`,
      );

      // Start a new orchestration session
      const signal = startNewSession();

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVibration, vibrationPower, "vibration");

      // Record intended power immediately for DeviceInfo visibility
      updateState(vibrationPower);

      const diff = 1 / steps;
      const delay = duration / steps;

      try {
        // SYNC STEP: Trigger the motor IMMEDIATELY with a small prime
        // Also ensure vacuum is SILENCED for this exclusive piston session
        await setVibration(device, deviceVersion, enforceVibration(0.1));
        await setVacuum(device, deviceVersion, 0);

        // Background sequence for the thrusting pattern
        (async () => {
          try {
            for (let i = 1; i < steps; i++) {
              // Exit immediately if a new command session has started
              if (signal.aborted) return;

              await new Promise((resolve) => setTimeout(resolve, delay));
              if (signal.aborted) return;

              const intensity = diff * i;
              const actualIntensity =
                deviceVersion === "original"
                  ? vibrationPower // Keep base power steady on one vibrator
                  : intensity * vibrationPower; // Ramp up on Neo 2

              await setVibration(
                device,
                deviceVersion,
                enforceVibration(actualIntensity),
              );
            }

            // Only stop if this session is still the active one
            if (!signal.aborted) {
              await stopAll(device);
              debugLog("PistonTool", "Sequence completed.");
            }
          } catch (error) {
            if (!signal.aborted) {
              errorLog("PistonTool", "Background sequence error:", error);
            }
          }
        })();

        return {
          content: [
            {
              type: "text",
              text: `Started piston motion sequence (${duration}ms). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("PistonTool", "Failed to start piston motion:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error starting piston motion: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
