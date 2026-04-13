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
import { enforceVibration, enforceVacuum, validateTransition } from "./enforcer.js";
import { CONFIG } from "../utils/config.js";
import { engine } from "../index.js";
import { getPattern } from "../utils/patternRegistry.js";

/**
 * Registers the unified Play tool with the MCP server.
 * One command that either plays a named custom pattern or runs a built-in
 * piston / vacuum / combo mode — all params have defaults so the minimal
 * invocation is just { customPattern: "name" } or { mode: "piston" }.
 */
export function createPlayTool(
  server: McpServer,
  device: Device,
  deviceVersion: SamNeoVersion,
) {
  server.tool(
    "Svakom-Sam-Neo-Play",
    `Unified play command. Provide 'customPattern' to run a loaded pattern, or pick a 'mode' (piston/vacuum/combo) and optionally tweak the params — every param has a sensible default.${
      CONFIG.HARD_MODE ? "" : " AI AGENTS: Intensity jumps >70% are prohibited."
    } Returns current device state.`,
    {
      // ── Custom pattern (overrides everything below when set) ──────────────
      customPattern: z
        .string()
        .optional()
        .describe(
          "Name of a pattern loaded via LoadPattern. When provided, all other params except 'duration' are ignored.",
        ),

      // ── Mode (ignored when customPattern is set) ──────────────────────────
      mode: z
        .enum(["piston", "vacuum", "combo"])
        .default("combo")
        .describe("Built-in mode: piston (vibration ramp), vacuum, or combo (both actuators)."),

      // ── Shared ────────────────────────────────────────────────────────────
      duration: z
        .number()
        .min(1000)
        .max(100000)
        .default(10000)
        .describe("Total duration in milliseconds."),

      // ── Vibration (piston + combo) ────────────────────────────────────────
      vibrationPower: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vibration intensity (0–1). Used by piston and combo modes."),
      steps: z
        .number()
        .min(20)
        .max(1000)
        .default(50)
        .describe("Number of keyframe steps in piston mode."),

      // ── Vacuum ────────────────────────────────────────────────────────────
      vacuumIntensity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vacuum/suction intensity (0–1). Used by vacuum and combo modes."),
      vacuumPattern: z
        .enum(["constant", "pulse", "wave"])
        .default("constant")
        .describe("Vacuum pattern for vacuum mode and combo independent mode."),
      pulseInterval: z
        .number()
        .min(100)
        .max(2000)
        .default(500)
        .optional()
        .describe("Pulse interval in ms for vacuum pulse pattern."),

      // ── Combo ─────────────────────────────────────────────────────────────
      syncMode: z
        .enum(["synchronized", "alternating", "independent"])
        .default("synchronized")
        .describe("Coordination style for combo mode."),
    },

    async ({
      customPattern,
      mode,
      duration,
      vibrationPower,
      steps,
      vacuumIntensity,
      vacuumPattern,
      pulseInterval = 500,
      syncMode,
    }) => {
      debugLog(
        "PlayTool",
        `Play: customPattern=${customPattern ?? "none"}, mode=${mode}, duration=${duration}ms`,
      );

      const signal = startNewSession();
      engine.stopAll();

      // ── Custom pattern branch ─────────────────────────────────────────────
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

        const patternIntensity = entry.intensity ?? Math.max(vibrationPower, vacuumIntensity);
        validateTransition(deviceState.lastVibration, patternIntensity, "vibration");
        validateTransition(deviceState.lastVacuum, patternIntensity, "vacuum");
        updateState(patternIntensity, patternIntensity);

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
              debugLog("PlayTool", "Custom pattern completed.");
            }
          }, duration);

          return {
            content: [
              {
                type: "text",
                text: `Playing custom pattern "${customPattern}" (${duration}ms). ${getStateSummary()}`,
              },
            ],
          };
        } catch (e) {
          errorLog("PlayTool", "Failed to start custom pattern:", e);
          return {
            content: [{ type: "text", text: `Error starting custom pattern: ${e}` }],
            isError: true,
          };
        }
      }

      // ── Built-in mode branch ──────────────────────────────────────────────
      const { vibrateIndex, vacuumIndex, vacuumOutputType } = getHardwareMap();
      const safeVib = enforceVibration(vibrationPower);
      const safeVac = enforceVacuum(vacuumIntensity);

      try {
        // ── PISTON ──────────────────────────────────────────────────────────
        if (mode === "piston") {
          validateTransition(deviceState.lastVibration, vibrationPower, "vibration");
          updateState(vibrationPower);

          const keyframes: Keyframe[] = [];
          const diff = 1 / steps;
          const delay = duration / steps;

          keyframes.push({ duration: 0, value: enforceVibration(0.1) });
          for (let i = 1; i < steps; i++) {
            const intensity = diff * i;
            const actual =
              deviceVersion === "original"
                ? vibrationPower
                : intensity * vibrationPower;
            keyframes.push({ duration: delay, value: enforceVibration(actual), easing: "linear" });
          }

          const id = await engine.play(device.index, [
            { featureIndex: vibrateIndex, outputType: "Vibrate", keyframes },
          ]);

          setTimeout(() => {
            if (!signal.aborted) { engine.stop(id); stopAll(device); }
          }, duration);

          return {
            content: [
              {
                type: "text",
                text: `Piston started (${duration}ms, ${steps} steps, power=${vibrationPower}). ${getStateSummary()}`,
              },
            ],
          };
        }

        // ── VACUUM ──────────────────────────────────────────────────────────
        if (mode === "vacuum") {
          validateTransition(deviceState.lastVacuum, vacuumIntensity, "vacuum");
          updateState(undefined, vacuumIntensity);

          const vacKeyframes: Keyframe[] = [];
          if (vacuumPattern === "constant") {
            vacKeyframes.push({ duration, value: safeVac });
          } else if (vacuumPattern === "pulse") {
            vacKeyframes.push({ duration: pulseInterval, value: safeVac, easing: "step" });
            vacKeyframes.push({ duration: pulseInterval, value: 0, easing: "step" });
          } else {
            vacKeyframes.push({ duration: duration / 2, value: safeVac, easing: "easeInOut" });
            vacKeyframes.push({ duration: duration / 2, value: 0, easing: "easeInOut" });
          }

          const id = await engine.play(
            device.index,
            [
              { featureIndex: vacuumIndex, outputType: vacuumOutputType, keyframes: vacKeyframes },
              { featureIndex: vibrateIndex, outputType: "Vibrate", keyframes: [{ duration, value: 0 }] },
            ],
            { loop: vacuumPattern !== "constant" },
          );

          setTimeout(() => {
            if (!signal.aborted) { engine.stop(id); stopAll(device); }
          }, duration);

          return {
            content: [
              {
                type: "text",
                text: `Vacuum started (${vacuumPattern}, ${duration}ms, intensity=${vacuumIntensity}). ${getStateSummary()}`,
              },
            ],
          };
        }

        // ── COMBO ───────────────────────────────────────────────────────────
        validateTransition(deviceState.lastVibration, vibrationPower, "vibration");
        validateTransition(deviceState.lastVacuum, vacuumIntensity, "vacuum");
        updateState(vibrationPower, vacuumIntensity);

        const vibKeyframes: Keyframe[] = [];
        const vacKeyframes: Keyframe[] = [];

        if (syncMode === "synchronized") {
          vibKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vacKeyframes.push({ duration: 0, value: enforceVacuum(0.1) });
          vibKeyframes.push({ duration, value: safeVib, easing: "linear" });
          vacKeyframes.push({ duration, value: safeVac, easing: "linear" });
        } else if (syncMode === "alternating") {
          vibKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vacKeyframes.push({ duration: 0, value: safeVac });
          vibKeyframes.push({ duration, value: safeVib, easing: "linear" });
          vacKeyframes.push({ duration, value: 0, easing: "linear" });
        } else {
          // independent
          vibKeyframes.push({ duration: 0, value: enforceVibration(0.1) });
          vibKeyframes.push({ duration, value: safeVib, easing: "linear" });

          if (vacuumPattern === "constant") {
            vacKeyframes.push({ duration, value: safeVac });
          } else if (vacuumPattern === "pulse") {
            const cycles = Math.floor(duration / (pulseInterval * 2));
            for (let i = 0; i < cycles; i++) {
              vacKeyframes.push({ duration: pulseInterval, value: safeVac, easing: "step" });
              vacKeyframes.push({ duration: pulseInterval, value: 0, easing: "step" });
            }
          } else {
            vacKeyframes.push({ duration: duration / 2, value: safeVac, easing: "easeInOut" });
            vacKeyframes.push({ duration: duration / 2, value: 0, easing: "easeInOut" });
          }
        }

        const id = await engine.play(device.index, [
          { featureIndex: vibrateIndex, outputType: "Vibrate", keyframes: vibKeyframes },
          { featureIndex: vacuumIndex, outputType: vacuumOutputType, keyframes: vacKeyframes },
        ]);

        setTimeout(() => {
          if (!signal.aborted) { engine.stop(id); stopAll(device); }
        }, duration);

        return {
          content: [
            {
              type: "text",
              text: `Combo started (${syncMode}, ${duration}ms, vib=${vibrationPower}, vac=${vacuumIntensity}). ${getStateSummary()}`,
            },
          ],
        };
      } catch (e) {
        errorLog("PlayTool", "Failed to start:", e);
        return {
          content: [{ type: "text", text: `Error: ${e}` }],
          isError: true,
        };
      }
    },
  );
}
