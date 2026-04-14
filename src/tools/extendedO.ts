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
import { getExtendedOPattern } from "./customPatterns.js";

/**
 * Registers the Extended O tool with the MCP server.
 * Provides climax management by temporarily reducing stimulation intensity.
 */
export function createExtendedOTools(
  server: McpServer,
  device: Device,
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
      patternName: z
        .string()
        .optional()
        .describe(
          "Name of a previously imported custom extendedO pattern. When provided, overrides the built-in hold/restore keyframes.",
        ),
    },

    async ({
      currentVibration,
      currentVacuum,
      holdDuration,
      restoreDuration,
      minimumLevel,
      patternName,
    }) => {
      debugLog(
        "ExtendedO",
        `Starting Extended O: drop to ${minimumLevel}, hold=${holdDuration}ms, restore=${restoreDuration}ms`,
      );

      // Start a new orchestration session
      const signal = startNewSession();
      engine.stopAll();

      const targetVibrate = currentVibration ?? deviceState.lastVibration;
      const targetVacuum = currentVacuum ?? deviceState.lastVacuum;

      // AI SAFETY: Prevent extreme jolts if starting from null/zero
      validateTransition(deviceState.lastVibration, targetVibrate, "vibration");
      validateTransition(deviceState.lastVacuum, targetVacuum, "vacuum");

      // Synchronously update tracked intensities
      updateState(targetVibrate, targetVacuum);

      const isNeo2 = deviceVersion === SamNeoVersion.NEO2_SERIES;
      const vacuumFeatureIndex = isNeo2 ? 0 : 1;
      const vacuumOutputType = isNeo2 ? "Constrict" : "Vibrate";

      // Use a custom pattern if requested
      const customPattern = patternName ? getExtendedOPattern(patternName) : undefined;
      if (patternName && !customPattern) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Custom extendedO pattern "${patternName}" not found. Import it first with Svakom-Sam-Neo-ImportPattern.`,
            },
          ],
          isError: true,
        };
      }

      try {
        let vibrationKeyframes: Keyframe[];
        let vacuumKeyframes: Keyframe[];

        if (customPattern) {
          vibrationKeyframes = customPattern.vibrationKeyframes;
          vacuumKeyframes = customPattern.vacuumKeyframes;
        } else {
          vibrationKeyframes = [];
          vacuumKeyframes = [];

          // 1. Immediately drop to minimum Level
          vibrationKeyframes.push({ duration: 0, value: enforceVibration(minimumLevel) });
          vacuumKeyframes.push({ duration: 0, value: enforceVacuum(minimumLevel) });

          // 2. Hold at minimum level
          vibrationKeyframes.push({ duration: holdDuration, value: enforceVibration(minimumLevel) });
          vacuumKeyframes.push({ duration: holdDuration, value: enforceVacuum(minimumLevel) });

          // 3. Restore to target level
          if (restoreDuration > 0) {
            vibrationKeyframes.push({ duration: restoreDuration, value: enforceVibration(targetVibrate), easing: "easeInOut" });
            vacuumKeyframes.push({ duration: restoreDuration, value: enforceVacuum(targetVacuum), easing: "easeInOut" });
          }
        }

        // Total duration: keyframe durations sum
        const totalDuration = customPattern
          ? vibrationKeyframes.reduce((acc, kf) => acc + kf.duration, 0)
          : holdDuration + restoreDuration;

        // Fire the pattern through the engine and capture the id for explicit stop
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
          },
        ]);

        // Stop the engine pattern after total duration
        setTimeout(() => {
          if (!signal.aborted) {
            engine.stop(id);
            stopAll(device); // Reset levels to 0
            debugLog("ExtendedO", "Sequence completed.");
          }
        }, totalDuration);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  patternType: "extendedO",
                  status: `Started Extended O climax control sequence (${holdDuration}ms hold, ${restoreDuration}ms restore).`,
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
