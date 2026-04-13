import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Device, type Keyframe } from "@zendrex/buttplug.js";
import {
  type SamNeoVersion,
  deviceState,
  stopAll,
  updateState,
  startNewSession,
  getStateSummary,
  getHardwareMap,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVibration, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";
import { getPattern } from "../utils/patternRegistry.js";

/**
 * Registers the Piston-like motion tool with the MCP server.
 * Handles rhythmic vibration patterns and session orchestration.
 */
export function createPistonTools(
  server: McpServer,
  device: Device,
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
      customPattern: z
        .string()
        .optional()
        .describe(
          "Name of a custom pattern loaded via LoadPattern. When provided, plays that pattern for 'duration' ms instead of the built-in piston motion.",
        ),
    },

    async ({ duration, steps, vibrationPower, customPattern }) => {
      debugLog(
        "PistonTool",
        `Starting piston motion: duration=${duration}ms, steps=${steps}, power=${vibrationPower}`,
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

        const patternIntensity = entry.intensity ?? vibrationPower;
        validateTransition(deviceState.lastVibration, patternIntensity, "vibration");
        updateState(patternIntensity);

        try {
          const id = await engine.play(
            device.index,
            entry.tracks,
            { loop: entry.loop, intensity: entry.intensity, timeout: duration },
          );

          setTimeout(() => {
            if (!signal.aborted) {
              engine.stop(id);
              stopAll(device);
              debugLog("PistonTool", "Custom pattern sequence completed.");
            }
          }, duration);

          return {
            content: [
              {
                type: "text",
                text: `Started custom pattern "${customPattern}" as piston (${duration}ms). ${getStateSummary()}`,
              },
            ],
          };
        } catch (e) {
          errorLog("PistonTool", "Failed to start custom pattern:", e);
          return {
            content: [{ type: "text", text: `Error starting custom pattern: ${e}` }],
            isError: true,
          };
        }
      }

      // AI SAFETY: Prevent extreme jolts
      validateTransition(deviceState.lastVibration, vibrationPower, "vibration");

      // Record intended power immediately for DeviceInfo visibility
      updateState(vibrationPower);

      const diff = 1 / steps;
      const delay = duration / steps;

      try {
        // Construct the keyframes
        const keyframes: Keyframe[] = [];
        const { vibrateIndex } = getHardwareMap();
        
        // SYNC STEP: Trigger the motor IMMEDIATELY with a small prime
        keyframes.push({ duration: 0, value: enforceVibration(0.1) });

        for (let i = 1; i < steps; i++) {
          const intensity = diff * i;
          const actualIntensity =
            deviceVersion === "original"
              ? vibrationPower // Keep base power steady on one vibrator
              : intensity * vibrationPower; // Ramp up on Neo 2
              
          keyframes.push({
            duration: delay,
            value: enforceVibration(actualIntensity),
            // Defaulting to linear easing for smooth thrusting interpolation
            easing: "linear",
          });
        }

        // Fire the pattern through the engine
        const id = await engine.play(device.index, [
          {
            featureIndex: vibrateIndex,
            outputType: "Vibrate",
            keyframes: keyframes,
          }
        ]);

        // Stop the engine pattern after duration
        setTimeout(() => {
          if (!signal.aborted) {
            engine.stop(id);
            stopAll(device); // Reset levels to 0
            debugLog("PistonTool", "Sequence completed.");
          }
        }, duration);

        return {
          content: [
            {
              type: "text",
              text: `Started pattern engine piston motion sequence (${duration}ms). ${getStateSummary()}`,
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
