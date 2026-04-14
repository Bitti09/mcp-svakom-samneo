/**
 * Unit tests for pattern expiration / cancellation behavior across all MCP tools.
 *
 * The engine is fully mocked so no real BLE device is required.
 * Each test focuses on the arguments passed to engine.play() and the
 * cleanup callbacks that ensure the device is zeroed when a session ends.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mock objects (available inside vi.mock factories) ───────────────
const { mockEngine, mockStopAll, mockSetVibration, mockSetVacuum } = vi.hoisted(() => {
  const mockEngine = {
    play: vi.fn().mockResolvedValue("mock-pattern-id"),
    stop: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockReturnValue(0),
  };
  const mockStopAll = vi.fn().mockResolvedValue(undefined);
  const mockSetVibration = vi.fn().mockResolvedValue(undefined);
  const mockSetVacuum = vi.fn().mockResolvedValue(undefined);
  return { mockEngine, mockStopAll, mockSetVibration, mockSetVacuum };
});

// ── Mock: PatternEngine ─────────────────────────────────────────────────────
vi.mock("../src/index.js", () => ({ engine: mockEngine }));

// ── Mock: hardware helpers that touch a real device ─────────────────────────
// We keep the real startNewSession / deviceState so session-abort logic
// is exercised, but replace the hardware I/O calls with no-ops.
vi.mock("../src/utils/hardware.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/utils/hardware.js")>();
  return {
    ...real,
    stopAll: mockStopAll,
    setVibration: mockSetVibration,
    setVacuum: mockSetVacuum,
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock McpServer that captures the last registered tool handler.
 */
function makeMockServer() {
  let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;
  const server = {
    tool: vi.fn(
      (
        _name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        capturedHandler = handler;
      },
    ),
    getHandler: () => capturedHandler,
  };
  return server;
}

/**
 * Minimal mock Device that exposes only the fields our tools reference.
 */
function makeMockDevice(index = 0) {
  return {
    index,
    name: "Svakom Sam Neo 2 Pro",
    displayName: "Svakom Sam Neo 2 Pro",
    canOutput: (t: string) => t === "Vibrate" || t === "Constrict",
    vibrate: vi.fn().mockResolvedValue(undefined),
    constrict: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Imports (after mocks are hoisted) ──────────────────────────────────────
import { SamNeoVersion, initializeHardware, deviceState } from "../src/utils/hardware.js";
import { createVacuumTools } from "../src/tools/vacuum.js";
import { createExtendedOTools } from "../src/tools/extendedO.js";
import { createPistonTools } from "../src/tools/piston.js";
import { createComboTools } from "../src/tools/combo.js";

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  deviceState.lastVibration = 0;
  deviceState.lastVacuum = 0;
  const device = makeMockDevice();
  initializeHardware(device as any, SamNeoVersion.NEO2_SERIES);
});

// ════════════════════════════════════════════════════════════════════════════
// Vacuum tool
// ════════════════════════════════════════════════════════════════════════════

describe("Vacuum tool", () => {
  it("pulse pattern uses the built-in 'pulse' preset", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ intensity: 0.6, duration: 4000, pattern: "pulse", pulseInterval: 500 });

    expect(mockEngine.play).toHaveBeenCalledOnce();
    const [, preset, opts] = mockEngine.play.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(preset).toBe("pulse");
    expect(opts.intensity).toBeCloseTo(0.6, 2);
    expect(opts.loop).toBe(true);
    expect(opts.timeout).toBe(4000);
    expect(typeof opts.onStop).toBe("function");
  });

  it("pulse speed maps pulseInterval correctly (500ms → speed 1, 250ms → speed 2)", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    // Default 500 ms interval → speed 1
    await handler({ intensity: 0.5, duration: 2000, pattern: "pulse", pulseInterval: 500 });
    let opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.speed).toBeCloseTo(1, 5);

    vi.clearAllMocks();

    // 250 ms interval → speed 2
    await handler({ intensity: 0.5, duration: 2000, pattern: "pulse", pulseInterval: 250 });
    opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.speed).toBeCloseTo(2, 5);
  });

  it("wave pattern uses the built-in 'wave' preset", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ intensity: 0.7, duration: 6000, pattern: "wave" });

    expect(mockEngine.play).toHaveBeenCalledOnce();
    const [, preset, opts] = mockEngine.play.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(preset).toBe("wave");
    // enforceVacuum snaps 0.7 to the nearest 0.2-step → 0.8
    expect(opts.intensity).toBeCloseTo(0.8, 2);
    expect(opts.loop).toBe(true);
    expect(opts.timeout).toBe(6000);
  });

  it("constant pattern passes timeout matching the requested duration", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ intensity: 0.5, duration: 3000, pattern: "constant" });

    expect(mockEngine.play).toHaveBeenCalledOnce();
    const opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.timeout).toBe(3000);
  });

  it("silences vibration before starting the engine pattern", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ intensity: 0.5, duration: 2000, pattern: "constant" });

    // setVibration(0) must be called before engine.play
    const vibCallOrder = mockSetVibration.mock.invocationCallOrder[0];
    const playCallOrder = mockEngine.play.mock.invocationCallOrder[0];
    expect(vibCallOrder).toBeLessThan(playCallOrder);
  });

  it("onStop calls stopAll when session is not aborted", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createVacuumTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ intensity: 0.5, duration: 2000, pattern: "pulse", pulseInterval: 500 });

    const opts = mockEngine.play.mock.calls[0][2] as { onStop: (id: string, reason: string) => void };
    // Simulate engine firing onStop with reason "timeout"
    opts.onStop("mock-pattern-id", "timeout");

    // stopAll should eventually be called (it's fire-and-forget via void)
    await Promise.resolve(); // flush microtasks
    expect(mockStopAll).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ExtendedO tool
// ════════════════════════════════════════════════════════════════════════════

describe("ExtendedO tool", () => {
  it("timeout equals holdDuration + restoreDuration", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createExtendedOTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({
      currentVibration: 0.5,
      currentVacuum: 0.5,
      holdDuration: 5000,
      restoreDuration: 3000,
      minimumLevel: 0.1,
    });

    expect(mockEngine.play).toHaveBeenCalledOnce();
    const opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.timeout).toBe(8000); // 5000 + 3000
  });

  it("engine.play is called with tracks (not a preset name)", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createExtendedOTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({
      currentVibration: 0.4,
      currentVacuum: 0.4,
      holdDuration: 4000,
      restoreDuration: 2000,
      minimumLevel: 0.1,
    });

    // Second arg must be an array of tracks, not a string preset
    const tracks = mockEngine.play.mock.calls[0][1];
    expect(Array.isArray(tracks)).toBe(true);
  });

  it("onStop is provided to the engine", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createExtendedOTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({
      holdDuration: 3000,
      restoreDuration: 2000,
      minimumLevel: 0.1,
    });

    const opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(typeof opts.onStop).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Piston tool
// ════════════════════════════════════════════════════════════════════════════

describe("Piston tool", () => {
  it("timeout matches the requested duration", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createPistonTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ duration: 5000, steps: 20, vibrationPower: 0.5 });

    const opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.timeout).toBe(5000);
  });

  it("onStop is provided and calls stopAll when not aborted", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createPistonTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ duration: 3000, steps: 20, vibrationPower: 0.6 });

    const opts = mockEngine.play.mock.calls[0][2] as { onStop: (id: string, reason: string) => void };
    opts.onStop("mock-pattern-id", "timeout");
    await Promise.resolve();
    expect(mockStopAll).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Combo tool
// ════════════════════════════════════════════════════════════════════════════

describe("Combo tool", () => {
  it("timeout matches the requested duration", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createComboTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    await handler({ duration: 8000, steps: 50, vibrationPower: 0.5, vacuumIntensity: 0.5, syncMode: "synchronized" });

    const opts = mockEngine.play.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.timeout).toBe(8000);
  });

  it("independent/pulse generates deterministic keyframes spanning the full duration", async () => {
    const server = makeMockServer();
    const device = makeMockDevice();
    createComboTools(server as any, device as any, SamNeoVersion.NEO2_SERIES);
    const handler = server.getHandler();

    const duration = 4000;
    const pInterval = 500;
    const expectedCycles = Math.floor(duration / (pInterval * 2)); // 4

    await handler({
      duration,
      steps: 50,
      vibrationPower: 0.5,
      vacuumIntensity: 0.6,
      syncMode: "independent",
      vacuumPattern: "pulse",
    });

    // For Neo2: vacuum uses featureIndex=0 with outputType="Constrict"
    const tracks = mockEngine.play.mock.calls[0][1] as Array<{ featureIndex: number; outputType: string; keyframes: unknown[] }>;
    const vacuumTrack = tracks.find((t) => t.outputType === "Constrict");
    expect(vacuumTrack).toBeDefined();
    // Each cycle adds 2 keyframes (on + off)
    expect(vacuumTrack!.keyframes.length).toBe(expectedCycles * 2);
  });
});
