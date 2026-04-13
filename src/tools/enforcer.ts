import { CONFIG } from "../utils/config.js";

/**
 * Clamps and rounds vibration intensity to 10 discrete hardware steps (0.0 to 1.0).
 * Ensures that any non-zero request results in at least the minimum vibration (0.1).
 */
export function enforceVibration(v: number): number {
  if (v <= 0) return 0;
  // Ensure we don't round down to 0 for very low intensities
  const rounded = Math.round(v * 10) / 10;
  return Math.max(0.1, Math.min(1.0, rounded));
}

/**
 * Clamps and rounds vacuum intensity to 5 discrete hardware steps (0.0 to 1.0).
 * Ensures that any non-zero request results in at least the minimum suction (0.2).
 */
export function enforceVacuum(v: number): number {
  if (v <= 0) return 0;
  // Svakom Sam Neo 2 has 5 steps for vacuum (0.2, 0.4, 0.6, 0.8, 1.0)
  const rounded = Math.round(v * 5) / 5;
  return Math.max(0.2, Math.min(1.0, rounded));
}

/**
 * Ensures that intensity transitions are safe and immersive.
 * Throws an error if the jump is too extreme (e.g. > 0.7 delta).
 */
export function validateTransition(
  current: number,
  target: number,
  type: string,
) {
  if (CONFIG.HARD_MODE) return;

  const delta = Math.abs(target - current);
  if (delta > 0.7) {
    throw new Error(
      `Extreme ${type} intensity jump detected (Delta: ${Math.round(
        delta * 100,
      )}%). ` +
        `For safety and immersion, sudden jumps over 70% are prohibited. ` +
        `Please ramp up gradually or use the Piston tool.`,
    );
  }
}
