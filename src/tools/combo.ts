import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ButtplugClientDevice } from "buttplug";
import {
  type SamNeoVersion,
  deviceState,
  setVibration,
  setVacuum,
  setCombined,
  stopAll,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVibration, enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";

/**
 * Registers the Combo tool with the MCP server.
 * Handles simultaneous coordination of vibration and vacuum actuators.
 */
export function createComboTools(
  server: McpServer,
  device: ButtplugClientDevice,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-Combo",
    `Simultaneous vibration and vacuum control.${
      CONFIG.HARD_MODE ? "" : " AI AGENTS: Intensity jumps >70% are prohibited."
    } Returns current device state.`,
    {
      duration: z
        .number()
        .min(1000)
        .max(100000)
        .describe("Total duration in milliseconds."),
      steps: z
        .number()
        .min(20)
        .max(1000)
        .default(100)
        .describe("Number of steps for the motion pattern."),
      vibrationPower: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Base vibration intensity."),
      vacuumIntensity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vacuum/suction intensity."),
      syncMode: z
        .enum(["synchronized", "alternating", "independent"])
        .default("synchronized")
        .describe("Coordination style between vibration and vacuum."),
      vacuumPattern: z
        .enum(["constant", "pulse", "wave"])
        .default("constant")
        .describe("Vacuum pattern for independent mode."),
    },

    async ({
      duration,
      steps,
      vibrationPower,
      vacuumIntensity,
      syncMode,
      vacuumPattern,
    }) => {
      debugLog(
        "ComboTool",
        `Starting combo: duration=${duration}ms, mode=${syncMode}, v=${vibrationPower}, vac=${vacuumIntensity}`,
      );

      // Start a new orchestration session
      const signal = startNewSession();

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVibration, vibrationPower, "vibration");
      validateTransition(deviceState.lastVacuum, vacuumIntensity, "vacuum");

      // Synchronously update the tracked state
      updateState(vibrationPower, vacuumIntensity);

      const diff = 1 / steps;
      const delay = duration / steps;

      try {
        // SYNC STEP: Prime BOTH immediately
        await setCombined(
          device,
          deviceVersion,
          enforceVibration(0.1),
          enforceVacuum(0.1),
        );

        // Background sequence
        (async () => {
          try {
            if (syncMode === "synchronized") {
              for (let i = 1; i < steps; i++) {
                if (signal.aborted) return;
                await new Promise((resolve) => setTimeout(resolve, delay));
                if (signal.aborted) return;

                const intensity = diff * i;
                await setCombined(
                  device,
                  deviceVersion,
                  enforceVibration(intensity * vibrationPower),
                  enforceVacuum(intensity * vacuumIntensity),
                );
              }
            } else if (syncMode === "alternating") {
              for (let i = 1; i < steps; i++) {
                if (signal.aborted) return;
                await new Promise((resolve) => setTimeout(resolve, delay));
                if (signal.aborted) return;

                const intensity = diff * i;
                await setCombined(
                  device,
                  deviceVersion,
                  enforceVibration(intensity * vibrationPower),
                  enforceVacuum((1 - intensity) * vacuumIntensity),
                );
              }
            } else if (syncMode === "independent") {
              // Parallel execution for independent patterns
              const vibPromise = (async () => {
                for (let i = 1; i < steps; i++) {
                  if (signal.aborted) return;
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  if (signal.aborted) return;

                  const intensity = diff * i;
                  await setVibration(
                    device,
                    deviceVersion,
                    enforceVibration(intensity * vibrationPower),
                  );
                }
              })();

              const vacPromise = (async () => {
                if (vacuumPattern === "constant") {
                  if (signal.aborted) return;
                  await setVacuum(
                    device,
                    deviceVersion,
                    enforceVacuum(vacuumIntensity),
                  );
                  await new Promise((resolve) => setTimeout(resolve, duration));
                } else if (vacuumPattern === "pulse") {
                  const pInterval = 500;
                  const cycles = Math.floor(duration / (pInterval * 2));
                  for (let i = 0; i < cycles; i++) {
                    if (signal.aborted) return;
                    await new Promise((resolve) =>
                      setTimeout(resolve, pInterval),
                    );
                    if (signal.aborted) return;

                    await setVacuum(device, deviceVersion, 0);
                    if (signal.aborted) return;

                    await new Promise((resolve) =>
                      setTimeout(resolve, pInterval),
                    );
                    if (signal.aborted) return;

                    if (i < cycles - 1) {
                      await setVacuum(
                        device,
                        deviceVersion,
                        enforceVacuum(vacuumIntensity),
                      );
                    }
                  }
                } else if (vacuumPattern === "wave") {
                  const sCount = 20;
                  const sDelay = duration / (sCount * 2);
                  for (let i = 1; i <= sCount; i++) {
                    if (signal.aborted) return;
                    await new Promise((resolve) => setTimeout(resolve, sDelay));
                    if (signal.aborted) return;

                    await setVacuum(
                      device,
                      deviceVersion,
                      enforceVacuum((i / sCount) * vacuumIntensity),
                    );
                  }
                  for (let i = sCount; i >= 0; i--) {
                    if (signal.aborted) return;
                    await new Promise((resolve) => setTimeout(resolve, sDelay));
                    if (signal.aborted) return;

                    await setVacuum(
                      device,
                      deviceVersion,
                      enforceVacuum((i / sCount) * vacuumIntensity),
                    );
                  }
                }
              })();

              await Promise.all([vibPromise, vacPromise]);
            }

            // Final stop - only if not aborted
            if (!signal.aborted) {
              await stopAll(device);
              debugLog("ComboTool", "Sequence completed.");
            }
          } catch (e) {
            if (!signal.aborted) {
              errorLog("ComboTool", "Background loop error:", e);
            }
          }
        })();

        return {
          content: [
            {
              type: "text",
              text: `Started combination sequence (${syncMode}, ${duration}ms). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("ComboTool", "Failed to start combo:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error starting combo: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
