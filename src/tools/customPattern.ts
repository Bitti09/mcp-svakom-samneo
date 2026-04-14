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

/** Zod schema for a single user-supplied keyframe. Easing is fully optional. */
const keyframeSchema = z.object({
  value: z
    .number()
    .min(0)
    .max(1)
    .describe("Target intensity (0.0–1.0)."),
  duration: z
    .number()
    .min(0)
    .describe("Duration to reach this value from the previous keyframe (ms). Use 0 for an instant jump."),
  easing: z
    .enum(["linear", "easeIn", "easeOut", "easeInOut", "step"])
    .optional()
    .describe("Interpolation curve. Omit to use the engine default."),
});

/**
 * Registers the Custom Pattern tool with the MCP server.
 * Allows arbitrary keyframe sequences to be played on any actuator type.
 */
export function createCustomPatternTools(
  server: McpServer,
  device: Device,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-CustomPattern",
    `Play a fully custom keyframe pattern on the device.${
      CONFIG.HARD_MODE ? "" : " AI AGENTS: Intensity jumps >70% are prohibited."
    } Choose the actuator type and supply your own keyframes. Returns current device state.`,
    {
      type: z
        .enum(["extendedO", "vacuum", "piston", "combo"])
        .describe(
          "Which actuator(s) to drive: 'piston' = vibration only, 'vacuum' = suction only, 'combo' / 'extendedO' = both together.",
        ),
      duration: z
        .number()
        .min(100)
        .max(100000)
        .describe("Total playback duration in milliseconds."),
      keyframes: z
        .array(keyframeSchema)
        .min(1)
        .optional()
        .describe(
          "Vibration keyframe sequence. Required for types: piston, combo, extendedO.",
        ),
      vacuumKeyframes: z
        .array(keyframeSchema)
        .min(1)
        .optional()
        .describe(
          "Vacuum keyframe sequence. Required for types: vacuum, combo, extendedO.",
        ),
    },

    async ({ type, duration, keyframes, vacuumKeyframes }) => {
      debugLog(
        "CustomPatternTool",
        `Starting custom pattern: type=${type}, duration=${duration}ms, kf=${keyframes?.length ?? 0}, vkf=${vacuumKeyframes?.length ?? 0}`,
      );

      // Validate that the caller provided the right keyframe arrays for the chosen type
      const needsVibration = type === "piston" || type === "combo" || type === "extendedO";
      const needsVacuum = type === "vacuum" || type === "combo" || type === "extendedO";

      if (needsVibration && (!keyframes || keyframes.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: 'keyframes' is required for type '${type}'.`,
            },
          ],
          isError: true,
        };
      }
      if (needsVacuum && (!vacuumKeyframes || vacuumKeyframes.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: 'vacuumKeyframes' is required for type '${type}'.`,
            },
          ],
          isError: true,
        };
      }

      // Start a new orchestration session and clear any running engine patterns
      const signal = startNewSession();
      engine.stopAll();

      // Derive representative intensities for safety validation
      const peakVibration = keyframes
        ? Math.max(...keyframes.map((kf) => kf.value))
        : 0;
      const peakVacuum = vacuumKeyframes
        ? Math.max(...vacuumKeyframes.map((kf) => kf.value))
        : 0;

      if (needsVibration) {
        validateTransition(deviceState.lastVibration, peakVibration, "vibration");
      }
      if (needsVacuum) {
        validateTransition(deviceState.lastVacuum, peakVacuum, "vacuum");
      }

      // Update tracked state synchronously
      updateState(
        needsVibration ? peakVibration : undefined,
        needsVacuum ? peakVacuum : undefined,
      );

      const isNeo2 = deviceVersion === SamNeoVersion.NEO2_SERIES;
      const vacuumFeatureIndex = isNeo2 ? 0 : 1;
      const vacuumOutputType = isNeo2 ? "Constrict" : "Vibrate";

      // Enforce hardware limits on all keyframe values
      const enforcedVibKf: Keyframe[] = keyframes
        ? keyframes.map((kf) => ({
            ...kf,
            value: enforceVibration(kf.value),
          }))
        : [];

      const enforcedVacKf: Keyframe[] = vacuumKeyframes
        ? vacuumKeyframes.map((kf) => ({
            ...kf,
            value: enforceVacuum(kf.value),
          }))
        : [];

      try {
        const onStop = (_id: string, reason: string) => {
          if (!signal.aborted) {
            void stopAll(device);
            debugLog("CustomPatternTool", `Sequence stopped (reason: ${reason}).`);
          }
        };

        // Build the track list according to the chosen type
        const tracks = [];

        if (needsVibration) {
          tracks.push({
            featureIndex: 0,
            outputType: "Vibrate" as const,
            keyframes: enforcedVibKf,
          });
        }

        if (needsVacuum) {
          tracks.push({
            featureIndex: vacuumFeatureIndex,
            outputType: vacuumOutputType as "Constrict" | "Vibrate",
            keyframes: enforcedVacKf,
          });
        }

        const id = await engine.play(device.index, tracks, {
          timeout: duration,
          onStop,
        });

        debugLog("CustomPatternTool", `Pattern id=${id} started.`);

        return {
          content: [
            {
              type: "text",
              text: `Started custom pattern engine sequence (type=${type}, ${duration}ms). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("CustomPatternTool", "Failed to start custom pattern:", e);
        void stopAll(device);
        return {
          content: [
            {
              type: "text",
              text: `Error starting custom pattern: ${e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
