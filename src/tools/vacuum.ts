import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Device } from "@zendrex/buttplug.js";
import {
  SamNeoVersion,
  deviceState,
  stopAll,
  setVibration,
  updateState,
  startNewSession,
  getStateSummary,
} from "../utils/hardware.js";
import { debugLog, errorLog } from "../utils/logger.js";
import { enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";

/**
 * Registers the Vacuum/Suction tool with the MCP server.
 * Supports constant, pulse, and wave suction patterns.
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
    },

    async ({ intensity, duration, pattern, pulseInterval = 500 }) => {
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

      try {
        // Silence vibration for this exclusive vacuum session
        await setVibration(device, deviceVersion, 0);

        const onStop = (_id: string, reason: string) => {
          if (!signal.aborted) {
            void stopAll(device);
            debugLog("VacuumTool", `Sequence stopped (reason: ${reason}).`);
          }
        };

        let id: string;

        if (pattern === "pulse") {
          // Built-in pulse preset: square-wave on/off.
          // speed = 500 / pulseInterval maps the default 1 s cycle to the requested interval.
          id = await engine.play(device.index, "pulse", {
            featureIndex: vacuumFeatureIndex,
            intensity: safeIntensity,
            speed: 500 / pulseInterval,
            loop: true,
            timeout: duration,
            onStop,
          });
        } else if (pattern === "wave") {
          // Built-in wave preset: smooth sine-wave oscillation.
          id = await engine.play(device.index, "wave", {
            featureIndex: vacuumFeatureIndex,
            intensity: safeIntensity,
            loop: true,
            timeout: duration,
            onStop,
          });
        } else {
          // constant: single keyframe that holds the level for the full duration.
          id = await engine.play(
            device.index,
            [
              {
                featureIndex: vacuumFeatureIndex,
                outputType: vacuumOutputType,
                keyframes: [{ duration: duration, value: safeIntensity }],
              },
            ],
            { timeout: duration, onStop },
          );
        }

        debugLog("VacuumTool", `Pattern id=${id} started.`);

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
