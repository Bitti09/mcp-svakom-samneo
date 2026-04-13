import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Device, type Keyframe } from "@zendrex/buttplug.js";
import {
  SamNeoVersion,
  deviceState,
  stopAll,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVibration, enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";

/**
 * Registers the Combo tool with the MCP server.
 * Handles simultaneous coordination of vibration and vacuum actuators.
 */
export function createComboTools(
  server: McpServer,
  device: Device,
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

      // Start a new orchestration session and clear any running engine patterns
      const signal = startNewSession();
      engine.stopAll();

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVibration, vibrationPower, "vibration");
      validateTransition(deviceState.lastVacuum, vacuumIntensity, "vacuum");

      // Synchronously update the tracked state
      updateState(vibrationPower, vacuumIntensity);

      const safeVib = enforceVibration(vibrationPower);
      const safeVac = enforceVacuum(vacuumIntensity);

      const isNeo2 = deviceVersion === SamNeoVersion.NEO2_SERIES;
      const vacuumFeatureIndex = isNeo2 ? 0 : 1;
      const vacuumOutputType = isNeo2 ? "Constrict" : "Vibrate";

      try {
        const vibrationKeyframes: Keyframe[] = [];
        const vacuumKeyframes: Keyframe[] = [];

        if (syncMode === "synchronized") {
          vibrationKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vacuumKeyframes.push({ duration: 0, value: enforceVacuum(0.1) });

          vibrationKeyframes.push({ duration: duration, value: safeVib, easing: "linear" });
          vacuumKeyframes.push({ duration: duration, value: safeVac, easing: "linear" });
          
        } else if (syncMode === "alternating") {
          vibrationKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vacuumKeyframes.push({ duration: 0, value: safeVac });

          vibrationKeyframes.push({ duration: duration, value: safeVib, easing: "linear" });
          vacuumKeyframes.push({ duration: duration, value: 0, easing: "linear" });

        } else if (syncMode === "independent") {
          // Vibration ramps up
          vibrationKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vibrationKeyframes.push({ duration: duration, value: safeVib, easing: "linear" });

          // Vacuum follows its independent pattern logic
          if (vacuumPattern === "constant") {
            vacuumKeyframes.push({ duration: duration, value: safeVac });
          } else if (vacuumPattern === "pulse") {
            const pInterval = 500;
            const cycles = Math.floor(duration / (pInterval * 2));
            for (let i = 0; i < cycles; i++) {
              vacuumKeyframes.push({ duration: pInterval, value: safeVac, easing: "step" });
              vacuumKeyframes.push({ duration: pInterval, value: 0, easing: "step" });
            }
          } else if (vacuumPattern === "wave") {
            vacuumKeyframes.push({ duration: duration / 2, value: safeVac, easing: "easeInOut" });
            vacuumKeyframes.push({ duration: duration / 2, value: 0, easing: "easeInOut" });
          }
        }

        // Play the multi-track pattern simultaneously
        const id = await engine.play(device.index, [
          {
            featureIndex: 0,
            outputType: "Vibrate",
            keyframes: vibrationKeyframes,
          },
          {
            featureIndex: vacuumFeatureIndex,
            outputType: vacuumOutputType,
            keyframes: vacuumKeyframes,
          }
        ]);

        // Stop the engine pattern after duration
        setTimeout(() => {
          if (!signal.aborted) {
            engine.stop(id);
            stopAll(device); // Reset levels to 0
            debugLog("ComboTool", "Sequence completed.");
          }
        }, duration);

        return {
          content: [
            {
              type: "text",
              text: `Started pattern engine combination sequence (${syncMode}, ${duration}ms). ${getStateSummary()}`,
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
