import { Device } from "@zendrex/buttplug.js";
import { debugLog } from "./logger.js";

// Session Management
let activeController: AbortController | null = null;
let globalDevice: Device | null = null;

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
 * Cached feature-index map discovered at startup from the device's Spec v4 feature map.
 * Allows tools to route PatternEngine tracks to the correct actuator without hardcoding.
 */
export interface HardwareMap {
  /** Feature index of the vibration actuator. */
  vibrateIndex: number;
  /** Feature index of the vacuum/suction actuator. */
  vacuumIndex: number;
  /** Output type for the vacuum actuator ("Constrict" on Neo2, "Vibrate" on Original). */
  vacuumOutputType: "Constrict" | "Vibrate";
}

let cachedHwMap: HardwareMap | null = null;

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
 * Initializes the hardware by discovering and caching the device's Spec v4 feature-index map.
 * Called once during startup in index.ts. The resulting map is used by tools to route
 * PatternEngine tracks to the correct actuator indices.
 */
export function initializeHardware(
  device: Device,
  version: SamNeoVersion,
) {
  debugLog("Hardware", `🔌 Discovering feature map for ${device.displayName ?? device.name}...`);
  globalDevice = device;

  const outputs = device.features.outputs;

  if (version === SamNeoVersion.NEO2_SERIES) {
    const vibrateFeature = outputs.find((f) => f.type === "Vibrate");
    const constrictFeature = outputs.find((f) => f.type === "Constrict");
    if (!vibrateFeature) {
      throw new Error(`initializeHardware: device "${device.displayName ?? device.name}" is missing a Vibrate output feature.`);
    }
    if (!constrictFeature) {
      throw new Error(`initializeHardware: device "${device.displayName ?? device.name}" is missing a Constrict output feature for Neo2.`);
    }
    cachedHwMap = {
      vibrateIndex: vibrateFeature.index,
      vacuumIndex: constrictFeature.index,
      vacuumOutputType: "Constrict",
    };
  } else {
    // Original Sam Neo: twin vibrators — first is vibration, second drives vacuum suction
    const vibrateFeatures = outputs.filter((f) => f.type === "Vibrate");
    if (vibrateFeatures.length < 2) {
      throw new Error(`initializeHardware: Original Sam Neo requires 2 Vibrate features; found ${vibrateFeatures.length}.`);
    }
    cachedHwMap = {
      vibrateIndex: vibrateFeatures[0]!.index,
      vacuumIndex: vibrateFeatures[1]!.index,
      vacuumOutputType: "Vibrate",
    };
  }

  debugLog(
    "Hardware",
    `✅ Feature map: vibrate[${cachedHwMap.vibrateIndex}], vacuum[${cachedHwMap.vacuumIndex}](${cachedHwMap.vacuumOutputType})`,
  );
}

/**
 * Returns the cached hardware feature-index map.
 * Throws if called before `initializeHardware`.
 */
export function getHardwareMap(): HardwareMap {
  if (!cachedHwMap) {
    throw new Error("Hardware not initialized. Call initializeHardware() first.");
  }
  return cachedHwMap;
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
