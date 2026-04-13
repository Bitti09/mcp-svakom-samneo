import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SamNeoVersion,
  initializeHardware,
  detectSamNeoVersion,
  setVibration,
  setVacuum,
  deviceState,
} from "../src/utils/hardware.js";
import { OutputType } from "buttplug";

describe("Sam Neo v4 Hardware Tests", () => {
  let mockDevice: any;

  beforeEach(() => {
    // Reset state before each test
    deviceState.lastVibration = 0;
    deviceState.lastVacuum = 0;

    // Create a mock Sam Neo 2 Pro (v4)
    const mockFeatures = new Map();
    
    // Feature 0: Vibrate
    mockFeatures.set(0, {
      hasOutput: (type: OutputType) => type === OutputType.Vibrate,
      runOutput: vi.fn().mockResolvedValue(undefined),
    });

    // Feature 1: Constrict
    mockFeatures.set(1, {
      hasOutput: (type: OutputType) => type === OutputType.Constrict,
      runOutput: vi.fn().mockResolvedValue(undefined),
    });

    mockDevice = {
      name: "Svakom Sam Neo 2 Pro",
      features: mockFeatures,
      hasOutput: (type: OutputType) => 
        type === OutputType.Vibrate || type === OutputType.Constrict,
    };
  });

  it("should correctly detect Sam Neo 2 Pro (v4) version", () => {
    const mockNeo2 = {
      name: "Sam Neo 2 Pro",
      features: new Map([
        [0, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
        [1, { hasOutput: (t: OutputType) => t === OutputType.Constrict }],
      ]),
      hasOutput: (t: OutputType) => t === OutputType.Vibrate || t === OutputType.Constrict,
    };
    const version = detectSamNeoVersion(mockNeo2 as any);
    console.log(`✅ Result: Detected version [${version}] for device [${mockNeo2.name}]`);
    expect(version).toBe(SamNeoVersion.NEO2_SERIES);
  });

  it("should correctly detect Original Sam Neo version", () => {
    const mockOriginal = {
      name: "Sam Neo",
      features: new Map([
        [0, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
        [1, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
      ]),
      hasOutput: (t: OutputType) => t === OutputType.Vibrate,
    };
    const version = detectSamNeoVersion(mockOriginal as any);
    console.log(`✅ Result: Detected version [${version}] for device [${mockOriginal.name}]`);
    expect(version).toBe(SamNeoVersion.ORIGINAL);
  });

  it("should reject other dual-vibrator Svakom devices (Vick Neo 2)", () => {
    const mockVick = {
      name: "Svakom Vick Neo 2",
      features: new Map([
        [0, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
        [1, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
      ]),
      hasOutput: (t: OutputType) => t === OutputType.Vibrate,
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
      features: new Map([
        [0, { hasOutput: (t: OutputType) => t === OutputType.Vibrate }],
        [1, { hasOutput: (t: OutputType) => t === OutputType.Oscillate }],
      ]),
      hasOutput: (t: OutputType) => t === OutputType.Vibrate || t === OutputType.Oscillate,
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
    
    const vibFeature = mockDevice.features.get(0);
    expect(vibFeature.runOutput).toHaveBeenCalled();
    expect(deviceState.lastVibration).toBe(0.5);
  });

  it("should route vacuum to the constrictor actuator on v4", async () => {
    initializeHardware(mockDevice, SamNeoVersion.NEO2_SERIES);
    
    await setVacuum(mockDevice, SamNeoVersion.NEO2_SERIES, 0.8);
    
    const vacFeature = mockDevice.features.get(1);
    expect(vacFeature.runOutput).toHaveBeenCalled();
    expect(deviceState.lastVacuum).toBe(0.8);
  });
});
