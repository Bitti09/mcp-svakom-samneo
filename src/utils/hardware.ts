import {
  ButtplugClientDevice,
  DeviceOutput,
  OutputType,
} from "buttplug";
import { debugLog } from "./logger.js";

// Session Management & Throttling
let activeController: AbortController | null = null;
let lastMessageTime: number = 0;
const THROTTLE_INTERVAL = 110; // User-defined safety margin in ms

/**
 * State for Target Reconciliation.
 * This ensures that if multiple calls come in during a throttle window,
 * only the LATEST values for each motor are sent.
 */
let targetVibration: number | null = null;
let targetVacuum: number | null = null;
let isHardwareProcessing = false;

/**
 * Starts a new stimulation session, instantly aborting any previous one.
 * Returns an AbortSignal that background loops must respect.
 */
export function startNewSession(): AbortSignal {
  if (activeController) {
    debugLog("Hardware", "⏹️ Aborting previous session...");
    activeController.abort();
  }
  activeController = new AbortController();
  return activeController.signal;
}

/**
 * Core throttled loop. Orchestrates sending target states to the device
 * while respecting the THROTTLE_INTERVAL and skipping stale intermediate states.
 */
async function reconcileHardwareState(version: SamNeoVersion) {
  if (isHardwareProcessing) return;
  isHardwareProcessing = true;

  try {
    // Keep processing while there are pending targets (fresh sets)
    while (targetVibration !== null || targetVacuum !== null) {
      if (!cache) break;

      const now = Date.now();
      const wait = Math.max(0, lastMessageTime + THROTTLE_INTERVAL - now);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      // Grab the latest targets and clear their flags
      const v = targetVibration;
      const vac = targetVacuum;
      targetVibration = null;
      targetVacuum = null;

      // Update timestamp BEFORE executing to keep the interval strict
      lastMessageTime = Date.now();

      try {
        const promises: Promise<void>[] = [];

        // 1. Process Vibration Update
        if (v !== null) {
          const vCmd = DeviceOutput.Vibrate.percent(v);
          if (version === SamNeoVersion.ORIGINAL) {
            promises.push(
              ...cache.vibrators.map((f: any) => f.runOutput(vCmd)),
            );
          } else if (cache.vibrators[0]) {
            promises.push(cache.vibrators[0].runOutput(vCmd));
          }
        }

        // 2. Process Vacuum Update
        if (vac !== null) {
          if (version === SamNeoVersion.NEO2_SERIES && cache.constrictor) {
            promises.push(
              cache.constrictor.runOutput(DeviceOutput.Constrict.percent(vac)),
            );
          } else if (
            version === SamNeoVersion.ORIGINAL &&
            cache.vacuumVibrator
          ) {
            promises.push(
              cache.vacuumVibrator.runOutput(DeviceOutput.Vibrate.percent(vac)),
            );
          }
        }

        if (promises.length > 0) {
          await Promise.all(promises);
        }
      } catch (e) {
        debugLog("Hardware", `❌ Hardware reconciliation failed: ${e}`);
      }
    }
  } finally {
    isHardwareProcessing = false;
  }
}

// Sam Neo device version enum
export enum SamNeoVersion {
  ORIGINAL = "original",
  NEO2_SERIES = "neo2_series", // Covers both Neo2 and Neo2 Pro
}

/**
 * Tracks the last sent intensity levels to allow stateful tools to function.
 */
export interface DeviceState {
  lastVibration: number;
  lastVacuum: number;
}

export const deviceState: DeviceState = {
  lastVibration: 0,
  lastVacuum: 0,
};

/**
 * Synchronously updates the tracked device state for immediate visibility in DeviceInfo.
 */
export function updateState(vibration?: number, vacuum?: number) {
  if (vibration !== undefined) deviceState.lastVibration = vibration;
  if (vacuum !== undefined) deviceState.lastVacuum = vacuum;
}

/**
 * Returns a concise, AI-friendly summary of the current device intensity state.
 */
export function getStateSummary(): string {
  return `[STATUS] Vibration: ${Math.round(deviceState.lastVibration * 100)}%, Vacuum: ${Math.round(deviceState.lastVacuum * 100)}%`;
}

/**
 * Hardware cache to store actuator references once identified.
 * We use 'any' here because the specific feature type is not exported by buttplug-js v4.
 */
interface HardwareCache {
  vibrators: any[];
  constrictor?: any;
  vacuumVibrator?: any;
}

let cache: HardwareCache | null = null;

/**
 * Initializes the hardware cache for the connected device.
 * Called once during startup in index.ts.
 */
export function initializeHardware(
  device: ButtplugClientDevice,
  version: SamNeoVersion,
) {
  debugLog("Hardware", `🔌 Initializing hardware cache for ${device.name}...`);
  const allFeatures = Array.from(device.features.values());

  const vibrators = allFeatures.filter((f) => f.hasOutput(OutputType.Vibrate));
  const constrictor = allFeatures.find((f) => f.hasOutput(OutputType.Constrict));

  cache = {
    vibrators,
    constrictor,
    // On Original Sam Neo, the second vibrator is used for vacuum
    vacuumVibrator:
      version === SamNeoVersion.ORIGINAL
        ? vibrators[1] || vibrators[0]
        : undefined,
  };

  debugLog(
    "Hardware",
    `✅ Cache built: ${vibrators.length} vibrators, ${
      constrictor ? "1" : "0"
    } constrictors identified.`,
  );
}

/**
 * Detects the Sam Neo device version based on its hardware features and name.
 * Implements strict verification using official Buttplug.io device names.
 */
export function detectSamNeoVersion(
  device: ButtplugClientDevice,
): SamNeoVersion {
  const normalizedName = device.name.toLowerCase();
  const hasConstrict = device.hasOutput(OutputType.Constrict);

  // Count vibration features
  let vibrateCount = 0;
  for (const feature of device.features.values()) {
    if (feature.hasOutput(OutputType.Vibrate)) {
      vibrateCount++;
    }
  }

  debugLog(
    "Hardware",
    `🔍 Feature detection [${device.name}]: hasConstrict=${hasConstrict}, vibrateCount=${vibrateCount}`,
  );

  // Safety: Verify this is actually a Sam Neo device before proceeding
  if (!normalizedName.includes("sam neo")) {
    const errorMsg = `Identity mismatch: Device "${device.name}" is not a recognized Sam Neo product.`;
    debugLog("Hardware", `🛡️  ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Sam Neo 2 / Pro: Exact signature (1 Vib + 1 Constrict)
  // Names: "Sam Neo 2", "Sam Neo 2 Pro"
  if (normalizedName.includes("sam neo 2") && hasConstrict && vibrateCount === 1) {
    debugLog("Hardware", `✅ Detected Sam Neo 2 / Pro series`);
    return SamNeoVersion.NEO2_SERIES;
  }

  // Original Sam Neo: Exact signature (2 Vibs, NO Constrict)
  // Name: "Sam Neo"
  if (!hasConstrict && vibrateCount === 2) {
    debugLog("Hardware", `✅ Detected Original Sam Neo series`);
    return SamNeoVersion.ORIGINAL;
  }

  const errorMsg = `Unsupported configuration for "${device.name}". Signature: [vibs:${vibrateCount}, suction:${hasConstrict ? "yes" : "no"}]`;
  debugLog("Hardware", `❌ ${errorMsg}`);
  throw new Error(errorMsg);
}

/**
 * Controls vibration for both Sam Neo versions using target reconciliation.
 */
export async function setVibration(
  _device: ButtplugClientDevice,
  version: SamNeoVersion,
  intensity: number,
) {
  targetVibration = intensity;
  return reconcileHardwareState(version);
}

/**
 * Controls vacuum/suction for both Sam Neo versions using target reconciliation.
 */
export async function setVacuum(
  _device: ButtplugClientDevice,
  version: SamNeoVersion,
  intensity: number,
) {
  targetVacuum = intensity;
  return reconcileHardwareState(version);
}

/**
 * Controls both vibration and vacuum simultaneously.
 */
export async function setCombined(
  _device: ButtplugClientDevice,
  version: SamNeoVersion,
  vibrationIntensity: number,
  vacuumIntensity: number,
) {
  targetVibration = vibrationIntensity;
  targetVacuum = vacuumIntensity;
  return reconcileHardwareState(version);
}

/**
 * Stops all movement on the device and resets state.
 */
export async function stopAll(device: ButtplugClientDevice) {
  await device.stop();
  deviceState.lastVibration = 0;
  deviceState.lastVacuum = 0;
}
