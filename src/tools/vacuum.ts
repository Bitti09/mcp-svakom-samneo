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
import { enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";
import { getVacuumPattern } from "./customPatterns.js";

/**
 * Registers the Vacuum/Suction tool with the MCP server.
 * Supports constant, pulse, and wave suction patterns, plus user-imported custom patterns.
 */
export function createVacuumTools(
  server: McpServer,
  device: Device,
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
      patternName: z
        .string()
        .optional()
        .describe(
          "Name of a previously imported custom vacuum pattern. When provided, overrides the built-in pattern keyframes.",
        ),
    },

    async ({ intensity, duration, pattern, pulseInterval = 500, patternName }) => {
      debugLog(
        "VacuumTool",
        `Starting vacuum: intensity=${intensity}, duration=${duration}ms, pattern=${pattern}`,
      );

      // Start a new orchestration session and clear any running engine patterns
      const signal = startNewSession();
      engine.stopAll();

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVacuum, intensity, "vacuum");

      // Synchronously update the tracked state
      updateState(undefined, intensity);

      const safeIntensity = enforceVacuum(intensity);

      const isNeo2 = deviceVersion === SamNeoVersion.NEO2_SERIES;
      const vacuumFeatureIndex = isNeo2 ? 0 : 1;
      const vacuumOutputType = isNeo2 ? "Constrict" : "Vibrate";

      // Use a custom pattern if requested
      const customPattern = patternName ? getVacuumPattern(patternName) : undefined;
      if (patternName && !customPattern) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Custom vacuum pattern "${patternName}" not found. Import it first with Svakom-Sam-Neo-ImportPattern.`,
            },
          ],
          isError: true,
        };
      }

      try {
        let keyframes: Keyframe[];
        let useLoop = false;

        if (customPattern) {
          keyframes = customPattern.keyframes;
        } else {
          keyframes = [];

          if (pattern === "constant") {
            keyframes.push({ duration: duration, value: safeIntensity });
          } else if (pattern === "pulse") {
            // Build full cycles that fill the duration
            const cycles = Math.max(1, Math.floor(duration / (pulseInterval * 2)));
            for (let i = 0; i < cycles; i++) {
              keyframes.push({ duration: pulseInterval, value: safeIntensity, easing: "step" });
              keyframes.push({ duration: pulseInterval, value: 0, easing: "step" });
            }
          } else if (pattern === "wave") {
            // Smooth sweeping interpolation
            keyframes.push({ duration: duration / 2, value: safeIntensity, easing: "easeInOut" });
            keyframes.push({ duration: duration / 2, value: 0, easing: "easeInOut" });
          }
        }

        // Fire the pattern through the engine
        const id = await engine.play(
          device.index,
          [
            {
              featureIndex: vacuumFeatureIndex,
              outputType: vacuumOutputType,
              keyframes: keyframes,
            },
            // Explicitly map vibration track to 0 to silence it during exclusive vacuum session
            {
              featureIndex: 0,
              outputType: "Vibrate",
              keyframes: [{ duration: duration, value: 0 }],
            },
          ],
          useLoop ? { loop: true } : undefined,
        );

        // Stop the engine pattern after duration
        setTimeout(() => {
          if (!signal.aborted) {
            engine.stop(id);
            stopAll(device); // Reset levels to 0
            debugLog("VacuumTool", "Sequence completed.");
          }
        }, duration);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  patternType: "vacuum",
                  status: `Started vacuum operation (${patternName ? `custom:${patternName}` : pattern}, ${duration}ms).`,
                  customPattern: patternName ?? null,
                  state: getStateSummary(),
                },
                null,
                2,
              ),
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
