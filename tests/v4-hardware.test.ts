import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SamNeoVersion,
  initializeHardware,
  detectSamNeoVersion,
  setVibration,
  setVacuum,
  getHardwareMap,
  deviceState,
} from "../src/utils/hardware.js";

/**
 * Minimal mock that satisfies the Device interface subset consumed by hardware.ts.
 * Uses the @zendrex/buttplug.js API: canOutput(), vibrate(), constrict(), stop().
 */
function makeMockDevice(opts: {
  name: string;
  displayName?: string | null;
  canVibrate?: boolean;
  canConstrict?: boolean;
  canOscillate?: boolean;
}) {
  const { name, displayName = null, canVibrate = false, canConstrict = false, canOscillate = false } = opts;
  const outputs: { type: string; index: number; description: string; range: [number, number] }[] = [];
  if (canVibrate) outputs.push({ type: "Vibrate", index: 0, description: "vibration", range: [0, 20] });
  if (canConstrict) outputs.push({ type: "Constrict", index: 1, description: "suction", range: [0, 5] });
  if (canOscillate) outputs.push({ type: "Oscillate", index: 1, description: "oscillation", range: [0, 20] });

  return {
    name,
    displayName,
    index: 0,
    features: { outputs, inputs: [] },
    canOutput: (type: string) => outputs.some((f) => f.type === type),
    vibrate: vi.fn().mockResolvedValue(undefined),
    constrict: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Sam Neo Hardware Tests", () => {
  let mockDevice: ReturnType<typeof makeMockDevice>;

  beforeEach(() => {
    // Reset state before each test
    deviceState.lastVibration = 0;
    deviceState.lastVacuum = 0;

    // Default mock: Sam Neo 2 Pro — Vibrate at index 0, Constrict at index 1
    mockDevice = makeMockDevice({
      name: "Svakom Sam Neo 2 Pro",
      canVibrate: true,
      canConstrict: true,
    });
  });

  // ── detectSamNeoVersion ──────────────────────────────────────────────────

  it("should correctly detect Sam Neo 2 Pro version", () => {
    const mock = makeMockDevice({ name: "Sam Neo 2 Pro", canVibrate: true, canConstrict: true });
    const version = detectSamNeoVersion(mock as any);
    console.log(`✅ Detected [${version}] for [${mock.name}]`);
    expect(version).toBe(SamNeoVersion.NEO2_SERIES);
  });

  it("should correctly detect Original Sam Neo version (twin vibrators, no constrict)", () => {
    // Original has two Vibrate features; canOutput("Constrict") returns false
    const mock = makeMockDevice({ name: "Sam Neo", canVibrate: true, canConstrict: false });
    const version = detectSamNeoVersion(mock as any);
    console.log(`✅ Detected [${version}] for [${mock.name}]`);
    expect(version).toBe(SamNeoVersion.ORIGINAL);
  });

  it("should reject non-Sam-Neo Svakom devices (Vick Neo 2)", () => {
    const mock = makeMockDevice({ name: "Svakom Vick Neo 2", canVibrate: true });
    expect(() => detectSamNeoVersion(mock as any)).toThrow(/Identity mismatch/);
    console.log("✅ Correctly rejected Svakom Vick Neo 2");
  });

  it("should reject unsupported hardware by name (Svakom Alex Neo)", () => {
    const mock = makeMockDevice({ name: "Svakom Alex Neo", canVibrate: true, canOscillate: true });
    expect(() => detectSamNeoVersion(mock as any)).toThrow(/Identity mismatch/);
    console.log("✅ Correctly rejected Svakom Alex Neo");
  });

  // ── initializeHardware + getHardwareMap ──────────────────────────────────

  it("should initialize hardware and build feature map for Neo2", () => {
    initializeHardware(mockDevice as any, SamNeoVersion.NEO2_SERIES);
    const map = getHardwareMap();
    expect(map.vibrateIndex).toBe(0);
    expect(map.vacuumIndex).toBe(1);
    expect(map.vacuumOutputType).toBe("Constrict");
  });

  it("should initialize hardware and build feature map for Original Sam Neo", () => {
    // Original: two Vibrate features at indices 0 and 1
    const original = {
      name: "Sam Neo",
      displayName: null,
      index: 0,
      features: {
        outputs: [
          { type: "Vibrate", index: 0, description: "vibration 1", range: [0, 20] as [number, number] },
          { type: "Vibrate", index: 1, description: "vibration 2", range: [0, 20] as [number, number] },
        ],
        inputs: [],
      },
      canOutput: (type: string) => type === "Vibrate",
      vibrate: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    initializeHardware(original as any, SamNeoVersion.ORIGINAL);
    const map = getHardwareMap();
    expect(map.vibrateIndex).toBe(0);
    expect(map.vacuumIndex).toBe(1);
    expect(map.vacuumOutputType).toBe("Vibrate");
  });

  it("should return the cached map after initializeHardware is called", () => {
    initializeHardware(mockDevice as any, SamNeoVersion.NEO2_SERIES);
    const map = getHardwareMap();
    expect(map).toMatchObject({
      vibrateIndex: expect.any(Number),
      vacuumIndex: expect.any(Number),
      vacuumOutputType: expect.any(String),
    });
  });

  // ── setVibration ──────────────────────────────────────────────────────────

  it("should call device.vibrate() with the given intensity on Neo2", async () => {
    initializeHardware(mockDevice as any, SamNeoVersion.NEO2_SERIES);
    await setVibration(mockDevice as any, SamNeoVersion.NEO2_SERIES, 0.5);
    expect(mockDevice.vibrate).toHaveBeenCalledWith(0.5);
  });

  it("should call device.vibrate() with per-feature array on Original Sam Neo", async () => {
    const original = {
      name: "Sam Neo",
      displayName: null,
      index: 0,
      features: {
        outputs: [
          { type: "Vibrate", index: 0, description: "vibration 1", range: [0, 20] as [number, number] },
          { type: "Vibrate", index: 1, description: "vibration 2", range: [0, 20] as [number, number] },
        ],
        inputs: [],
      },
      canOutput: (type: string) => type === "Vibrate",
      vibrate: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    initializeHardware(original as any, SamNeoVersion.ORIGINAL);
    await setVibration(original as any, SamNeoVersion.ORIGINAL, 0.5);
    // Original: vibrate called with array [{index: 0, value: 0.5}, {index: 1, value: 0 (lastVacuum)}]
    expect(original.vibrate).toHaveBeenCalledWith([
      { index: 0, value: 0.5 },
      { index: 1, value: 0 },
    ]);
  });

  // ── setVacuum ─────────────────────────────────────────────────────────────

  it("should call device.constrict() with the given intensity on Neo2", async () => {
    initializeHardware(mockDevice as any, SamNeoVersion.NEO2_SERIES);
    await setVacuum(mockDevice as any, SamNeoVersion.NEO2_SERIES, 0.8);
    expect(mockDevice.constrict).toHaveBeenCalledWith(0.8);
  });

  it("should call device.vibrate() with per-feature array for vacuum on Original Sam Neo", async () => {
    const original = {
      name: "Sam Neo",
      displayName: null,
      index: 0,
      features: {
        outputs: [
          { type: "Vibrate", index: 0, description: "vibration 1", range: [0, 20] as [number, number] },
          { type: "Vibrate", index: 1, description: "vibration 2", range: [0, 20] as [number, number] },
        ],
        inputs: [],
      },
      canOutput: (type: string) => type === "Vibrate",
      vibrate: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    initializeHardware(original as any, SamNeoVersion.ORIGINAL);
    await setVacuum(original as any, SamNeoVersion.ORIGINAL, 0.8);
    // Original: vacuum drives second vibrator; first stays at lastVibration (0)
    expect(original.vibrate).toHaveBeenCalledWith([
      { index: 0, value: 0 },
      { index: 1, value: 0.8 },
    ]);
  });
});

