import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SamNeoVersion,
  initializeHardware,
  detectSamNeoVersion,
  setVibration,
  setVacuum,
  deviceState,
  startNewSession,
} from "../src/utils/hardware.js";

describe("Sam Neo v4 Hardware Tests", () => {
  let mockDevice: any;

  beforeEach(() => {
    // Reset state before each test
    deviceState.lastVibration = 0;
    deviceState.lastVacuum = 0;

    // Create a mock Sam Neo 2 Pro (v4) using the @zendrex/buttplug.js Device API
    mockDevice = {
      name: "Svakom Sam Neo 2 Pro",
      displayName: "Svakom Sam Neo 2 Pro",
      index: 0,
      // @zendrex/buttplug.js uses canOutput(type) instead of hasOutput
      canOutput: (type: string) => type === "Vibrate" || type === "Constrict",
      vibrate: vi.fn().mockResolvedValue(undefined),
      constrict: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should correctly detect Sam Neo 2 Pro (v4) version", () => {
    const mockNeo2 = {
      name: "Sam Neo 2 Pro",
      displayName: "Sam Neo 2 Pro",
      canOutput: (t: string) => t === "Vibrate" || t === "Constrict",
    };
    const version = detectSamNeoVersion(mockNeo2 as any);
    console.log(`✅ Result: Detected version [${version}] for device [${mockNeo2.name}]`);
    expect(version).toBe(SamNeoVersion.NEO2_SERIES);
  });

  it("should correctly detect Original Sam Neo version", () => {
    const mockOriginal = {
      name: "Sam Neo",
      displayName: "Sam Neo",
      canOutput: (t: string) => t === "Vibrate",
    };
    const version = detectSamNeoVersion(mockOriginal as any);
    console.log(`✅ Result: Detected version [${version}] for device [${mockOriginal.name}]`);
    expect(version).toBe(SamNeoVersion.ORIGINAL);
  });

  it("should reject other dual-vibrator Svakom devices (Vick Neo 2)", () => {
    const mockVick = {
      name: "Svakom Vick Neo 2",
      displayName: "Svakom Vick Neo 2",
      canOutput: (t: string) => t === "Vibrate",
    };

    try {
      detectSamNeoVersion(mockVick as any);
    } catch (e: any) {
      console.log(`✅ Result: Correctly rejected [${mockVick.name}] - Error: ${e.message}`);
    }

    expect(() => detectSamNeoVersion(mockVick as any)).toThrow(/Identity mismatch/);
  });

  it("should throw error for unsupported hardware (Svakom Alex Neo)", () => {
    const mockAlexNeo = {
      name: "Svakom Alex Neo",
      displayName: "Svakom Alex Neo",
      canOutput: (t: string) => t === "Vibrate" || t === "Oscillate",
    };

    try {
      detectSamNeoVersion(mockAlexNeo as any);
    } catch (e: any) {
      console.log(`✅ Result: Correctly rejected [${mockAlexNeo.name}] - Error: ${e.message}`);
    }

    // Should throw "Identity mismatch"
    expect(() => detectSamNeoVersion(mockAlexNeo as any)).toThrow(
      /Identity mismatch/,
    );
  });

  it("should initialize hardware cache for v4", () => {
    // Should not throw
    initializeHardware(mockDevice, SamNeoVersion.NEO2_SERIES);
  });

  it("should route vibration to the correct v4 actuator", async () => {
    initializeHardware(mockDevice, SamNeoVersion.NEO2_SERIES);

    await setVibration(mockDevice, SamNeoVersion.NEO2_SERIES, 0.5);

    expect(mockDevice.vibrate).toHaveBeenCalledWith(0.5);
    // setVibration does not update deviceState; that is updateState's responsibility
  });

  it("should route vacuum to the constrictor actuator on v4", async () => {
    initializeHardware(mockDevice, SamNeoVersion.NEO2_SERIES);

    await setVacuum(mockDevice, SamNeoVersion.NEO2_SERIES, 0.8);

    expect(mockDevice.constrict).toHaveBeenCalledWith(0.8);
    // setVacuum does not update deviceState; that is updateState's responsibility
  });

  // ── Session replacement / cancellation ───────────────────────────────────

  it("should abort the previous session signal when a new session starts", () => {
    const signal1 = startNewSession();
    expect(signal1.aborted).toBe(false);

    const signal2 = startNewSession();
    expect(signal1.aborted).toBe(true);  // old session cancelled
    expect(signal2.aborted).toBe(false); // new session active
  });

  it("should return distinct signals for each new session", () => {
    const signal1 = startNewSession();
    const signal2 = startNewSession();
    expect(signal1).not.toBe(signal2);
  });

  it("should allow chaining multiple session replacements", () => {
    const s1 = startNewSession();
    const s2 = startNewSession();
    const s3 = startNewSession();

    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(true);
    expect(s3.aborted).toBe(false);
  });
});
