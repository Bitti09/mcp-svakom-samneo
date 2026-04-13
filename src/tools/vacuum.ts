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
  getHardwareMap,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";
import { getPattern, toDescriptor } from "../utils/patternRegistry.js";

/**
 * Registers the Vacuum/Suction tool with the MCP server.
 * Supports constant, pulse, and wave suction patterns.
 */
export function createVacuumTools(
  server: McpServer,
  device: Device,
  _deviceVersion: SamNeoVersion,
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
      customPattern: z
        .string()
        .optional()
        .describe(
          "Name of a custom pattern loaded via LoadPattern. When provided, plays that pattern for 'duration' ms instead of the built-in pattern.",
        ),
    },

    async ({ intensity, duration, pattern, pulseInterval = 500, customPattern }) => {
      debugLog(
        "VacuumTool",
        `Starting vacuum: intensity=${intensity}, duration=${duration}ms, pattern=${pattern}`,
      );

      // Start a new orchestration session and clear any running engine patterns
      const signal = startNewSession();
      engine.stopAll();

      // --- Custom pattern branch ---
      if (customPattern !== undefined) {
        const entry = getPattern(customPattern);
        if (!entry) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown custom pattern: "${customPattern}". Load it first with Svakom-Sam-Neo-LoadPattern.`,
              },
            ],
            isError: true,
          };
        }

        const patternIntensity = entry.intensity ?? intensity;
        validateTransition(deviceState.lastVacuum, patternIntensity, "vacuum");
        updateState(undefined, patternIntensity);

        try {
          const id = await engine.play(device.index, toDescriptor(entry), { timeout: duration });

          setTimeout(() => {
            if (!signal.aborted) {
              engine.stop(id);
              stopAll(device);
              debugLog("VacuumTool", "Custom pattern sequence completed.");
            }
          }, duration);

          return {
            content: [
              {
                type: "text",
                text: `Started custom pattern "${customPattern}" on vacuum (${duration}ms). ${getStateSummary()}`,
              },
            ],
          };
        } catch (e) {
          errorLog("VacuumTool", "Failed to start custom pattern:", e);
          return {
            content: [{ type: "text", text: `Error starting custom pattern: ${e}` }],
            isError: true,
          };
        }
      }

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVacuum, intensity, "vacuum");

      // Synchronously update the tracked state
      updateState(undefined, intensity);

      const safeIntensity = enforceVacuum(intensity);

      const { vibrateIndex, vacuumIndex, vacuumOutputType } = getHardwareMap();

      try {
        const keyframes: Keyframe[] = [];

        if (pattern === "constant") {
          keyframes.push({ duration: duration, value: safeIntensity });
        } else if (pattern === "pulse") {
          // Sharp on/off transitions
          keyframes.push({ duration: pulseInterval, value: safeIntensity, easing: "step" });
          keyframes.push({ duration: pulseInterval, value: 0, easing: "step" });
        } else if (pattern === "wave") {
          // Smooth sweeping interpolation
          keyframes.push({ duration: duration / 2, value: safeIntensity, easing: "easeInOut" });
          keyframes.push({ duration: duration / 2, value: 0, easing: "easeInOut" });
        }

        // Fire the pattern through the engine
        const id = await engine.play(
          device.index,
          [
            {
              featureIndex: vacuumIndex,
              outputType: vacuumOutputType,
              keyframes: keyframes,
            },
            // Explicitly map vibration track to 0 to silence it during exclusive vacuum session
            {
              featureIndex: vibrateIndex,
              outputType: "Vibrate",
              keyframes: [{ duration: duration, value: 0 }],
            }
          ],
          { loop: pattern !== "constant" }
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
              text: `Started pattern engine vacuum operation (${pattern}, ${duration}ms). ${getStateSummary()}`,
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
