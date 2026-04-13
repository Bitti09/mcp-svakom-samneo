import { Device } from "@zendrex/buttplug.js";
import { debugLog } from "./logger.js";

// Session Management
let activeController: AbortController | null = null;
let globalDevice: Device | null = null;

// Replaced by Zendrex PatternEngine orchestration
// Direct target state mapping handles simple static output now

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
 * Enumeration of supported Svakom Sam Neo hardware versions.
 */
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

/**
 * Singleton instance tracking the current intensity levels for all actuators.
 */
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
 * Initializes the hardware cache for the connected device.
 * Called once during startup in index.ts.
 */
export function initializeHardware(
  device: Device,
  version: SamNeoVersion,
) {
  debugLog("Hardware", `🔌 Initializing hardware mapping for ${device.displayName ?? device.name}...`);
  globalDevice = device;
  debugLog("Hardware", `✅ Mapping built for ${version}.`);
}

/**
 * Detects the Sam Neo device version based on its hardware features and name.
 */
export function detectSamNeoVersion(
  device: Device,
): SamNeoVersion {
  const normalizedName = (device.displayName ?? device.name).toLowerCase();
  const hasConstrict = device.canOutput("Constrict");
  
  debugLog(
    "Hardware",
    `🔍 Feature detection [${normalizedName}]: canConstrict=${hasConstrict}`,
  );

  // Safety: Verify this is actually a Sam Neo device before proceeding
  if (!normalizedName.includes("sam neo")) {
    const errorMsg = `Identity mismatch: Device "${normalizedName}" is not a recognized Sam Neo product.`;
    debugLog("Hardware", `🛡️  ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Sam Neo 2 / Pro: Has Constrict
  if (normalizedName.includes("sam neo 2") && hasConstrict) {
    debugLog("Hardware", `✅ Detected Sam Neo 2 / Pro series`);
    return SamNeoVersion.NEO2_SERIES;
  }

  // Original Sam Neo: Uses twin vibrators, no Constrict
  if (!hasConstrict) {
    debugLog("Hardware", `✅ Detected Original Sam Neo series`);
    // Ideally we would verify it has 2 vibrate features, but Zendrex abstracts this slightly.
    return SamNeoVersion.ORIGINAL;
  }

  const errorMsg = `Unsupported configuration for "${normalizedName}".`;
  debugLog("Hardware", `❌ ${errorMsg}`);
  throw new Error(errorMsg);
}

/**
 * Controls vibration for both Sam Neo versions directly.
 */
export async function setVibration(
  _device: Device,
  version: SamNeoVersion,
  intensity: number,
) {
  if (!globalDevice) return;
  try {
    if (version === SamNeoVersion.NEO2_SERIES) {
      await globalDevice.vibrate(intensity);
    } else {
      await globalDevice.vibrate([
        { index: 0, value: intensity },
        { index: 1, value: deviceState.lastVacuum }
      ]);
    }
  } catch (e) {
    debugLog("Hardware", `❌ Vibration failed: ${e}`);
  }
}

/**
 * Controls vacuum/suction for both Sam Neo versions directly.
 */
export async function setVacuum(
  _device: Device,
  version: SamNeoVersion,
  intensity: number,
) {
  if (!globalDevice) return;
  try {
    if (version === SamNeoVersion.NEO2_SERIES) {
      await globalDevice.constrict(intensity);
    } else {
      await globalDevice.vibrate([
        { index: 0, value: deviceState.lastVibration },
        { index: 1, value: intensity }
      ]);
    }
  } catch (e) {
    debugLog("Hardware", `❌ Vacuum failed: ${e}`);
  }
}

/**
 * Controls both vibration and vacuum simultaneously directly.
 */
export async function setCombined(
  _device: Device,
  version: SamNeoVersion,
  vibrationIntensity: number,
  vacuumIntensity: number,
) {
  if (!globalDevice) return;
  try {
    if (version === SamNeoVersion.NEO2_SERIES) {
      // Zendrex requires them to be discrete calls for neo 2
      await Promise.all([
        globalDevice.vibrate(vibrationIntensity),
        globalDevice.constrict(vacuumIntensity)
      ]);
    } else {
      await globalDevice.vibrate([
        { index: 0, value: vibrationIntensity },
        { index: 1, value: vacuumIntensity }
      ]);
    }
  } catch (e) {
    debugLog("Hardware", `❌ Combined output failed: ${e}`);
  }
}

/**
 * Stops all movement on the device and resets state.
 */
export async function stopAll(device: Device) {
  await device.stop();
  deviceState.lastVibration = 0;
  deviceState.lastVacuum = 0;
}
