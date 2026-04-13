import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice } from "buttplug";
import {
  type SamNeoVersion,
  deviceState,
  setVacuum,
  setVibration,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";

/**
 * Registers the Vacuum/Suction tool with the MCP server.
 * Supports constant, pulse, and wave suction patterns.
 */
export function createVacuumTools(
  server: McpServer,
  device: ButtplugClientDevice,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-Vacuum",
    `Controls the vacuum/suction functionality.${
      CONFIG.HARD_MODE ? "" : " AI AGENTS: Intensity jumps >70% are prohibited."
    } Returns current device state.`,
    {
      intensity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vacuum intensity level (0.0 to 1.0)."),
      duration: z
        .number()
        .min(100)
        .max(30000)
        .default(1000)
        .describe("Duration in milliseconds."),
      pattern: z
        .enum(["constant", "pulse", "wave"])
        .default("constant")
        .describe("Vaccum pattern: constant, pulse (on/off), wave (gradual)."),
      pulseInterval: z
        .number()
        .min(100)
        .max(2000)
        .default(500)
        .optional()
        .describe("Interval for pulse pattern (ms)."),
    },

    async ({ intensity, duration, pattern, pulseInterval = 500 }) => {
      debugLog(
        "VacuumTool",
        `Starting vacuum: intensity=${intensity}, duration=${duration}ms, pattern=${pattern}`,
      );

      // Start a new orchestration session
      const signal = startNewSession();

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVacuum, intensity, "vacuum");

      // Synchronously update the tracked state
      updateState(undefined, intensity);

      const safeIntensity = enforceVacuum(intensity);

      try {
        // SYNC STEP: Prime the motor
        // Also ensure vibration is SILENCED for this exclusive vacuum session
        const primeLevel = pattern === "wave" ? 0.2 : safeIntensity;
        await setVacuum(device, deviceVersion, primeLevel);
        await setVibration(device, deviceVersion, 0);

        // Background sequence
        (async () => {
          try {
            if (pattern === "constant") {
              await new Promise((resolve) => setTimeout(resolve, duration));
            } else if (pattern === "pulse") {
              const cycles = Math.floor(duration / (pulseInterval * 2));
              for (let i = 0; i < cycles; i++) {
                if (signal.aborted) return;

                await new Promise((resolve) =>
                  setTimeout(resolve, pulseInterval),
                );
                if (signal.aborted) return;

                await setVacuum(device, deviceVersion, 0);
                if (signal.aborted) return;

                await new Promise((resolve) =>
                  setTimeout(resolve, pulseInterval),
                );
                if (signal.aborted) return;

                if (i < cycles - 1) {
                  await setVacuum(device, deviceVersion, safeIntensity);
                }
              }
            } else if (pattern === "wave") {
              const steps = 20;
              const stepDuration = duration / (steps * 2);

              // Wave Up
              for (let i = 1; i <= steps; i++) {
                if (signal.aborted) return;
                await new Promise((resolve) =>
                  setTimeout(resolve, stepDuration),
                );
                if (signal.aborted) return;

                await setVacuum(
                  device,
                  deviceVersion,
                  enforceVacuum((i / steps) * intensity),
                );
              }

              // Wave Down
              for (let i = steps; i >= 0; i--) {
                if (signal.aborted) return;
                await new Promise((resolve) =>
                  setTimeout(resolve, stepDuration),
                );
                if (signal.aborted) return;

                await setVacuum(
                  device,
                  deviceVersion,
                  enforceVacuum((i / steps) * intensity),
                );
              }
            }

            // Final stop - only if not aborted
            if (!signal.aborted) {
              await setVacuum(device, deviceVersion, 0);
              debugLog("VacuumTool", "Sequence completed.");
            }
          } catch (e) {
            if (!signal.aborted) {
              errorLog("VacuumTool", "Background loop error:", e);
            }
          }
        })();

        return {
          content: [
            {
              type: "text",
              text: `Started vacuum operation (${pattern}, ${duration}ms). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("VacuumTool", "Failed to start vacuum:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error starting vacuum: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
