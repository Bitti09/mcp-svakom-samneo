import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice } from "buttplug";
import {
  type SamNeoVersion,
  deviceState,
  setCombined,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVibration, enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";

/**
 * Registers the Extended O tool with the MCP server.
 * Provides climax management by temporarily reducing stimulation intensity.
 */
export function createExtendedOTools(
  server: McpServer,
  device: ButtplugClientDevice,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-ExtendedO",
    `Extended O mode for climax control.${
      CONFIG.HARD_MODE ? "" : " AI AGENTS: Instantly reduces intensity; then restores."
    } Returns current device state.`,
    {
      currentVibration: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Initial vibration (uses last known state if omitted)."),
      currentVacuum: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Initial vacuum (uses last known state if omitted)."),
      holdDuration: z
        .number()
        .min(1000)
        .max(15000)
        .default(5000)
        .describe("Duration to hold the low intensity (ms)."),
      restoreDuration: z
        .number()
        .min(0)
        .max(10000)
        .default(3000)
        .describe("Duration to gradually restore intensity (ms)."),
      minimumLevel: z
        .number()
        .min(0)
        .max(0.3)
        .default(0.1)
        .describe("Low intensity level to drop to."),
    },

    async ({
      currentVibration,
      currentVacuum,
      holdDuration,
      restoreDuration,
      minimumLevel,
    }) => {
      debugLog(
        "ExtendedO",
        `Starting Extended O: drop to ${minimumLevel}, hold=${holdDuration}ms, restore=${restoreDuration}ms`,
      );

      // Start a new orchestration session
      const signal = startNewSession();

      const targetVibrate = currentVibration ?? deviceState.lastVibration;
      const targetVacuum = currentVacuum ?? deviceState.lastVacuum;

      // AI SAFETY: Prevent extreme jolts if starting from null/zero
      validateTransition(deviceState.lastVibration, targetVibrate, "vibration");
      validateTransition(deviceState.lastVacuum, targetVacuum, "vacuum");

      // Synchronously update tracked intensities
      updateState(targetVibrate, targetVacuum);

      try {
        // SYNC STEP: Immediately drop intensity
        await setCombined(
          device,
          deviceVersion,
          enforceVibration(minimumLevel),
          enforceVacuum(minimumLevel),
        );

        // Background sequence for hold and restore
        (async () => {
          try {
            // Step 1: Hold
            await new Promise((resolve) => setTimeout(resolve, holdDuration));
            if (signal.aborted) return;

            // Step 2: Restore
            if (restoreDuration === 0) {
              if (signal.aborted) return;
              await setCombined(
                device,
                deviceVersion,
                enforceVibration(targetVibrate),
                enforceVacuum(targetVacuum),
              );
            } else {
              const steps = 10;
              const stepDelay = restoreDuration / steps;
              const vibrationStep = (targetVibrate - minimumLevel) / steps;
              const vacuumStep = (targetVacuum - minimumLevel) / steps;

              for (let i = 1; i <= steps; i++) {
                if (signal.aborted) return;
                await new Promise((resolve) => setTimeout(resolve, stepDelay));
                if (signal.aborted) return;

                const vLevel = minimumLevel + vibrationStep * i;
                const vacLevel = minimumLevel + vacuumStep * i;
                await setCombined(
                  device,
                  deviceVersion,
                  enforceVibration(vLevel),
                  enforceVacuum(vacLevel),
                );
              }
            }
            if (!signal.aborted) {
              debugLog("ExtendedO", "Sequence completed.");
            }
          } catch (e) {
            if (!signal.aborted) {
              errorLog("ExtendedO", "Background loop error:", e);
            }
          }
        })();

        return {
          content: [
            {
              type: "text",
              text: `Started Extended O climax control sequence (${holdDuration}ms hold). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("ExtendedO", "Failed to activate Extended O:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error activating Extended O: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
