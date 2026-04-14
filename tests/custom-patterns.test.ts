import { describe, it, expect, beforeEach } from "vitest";
import {
  importCustomPattern,
  getPistonPattern,
  getVacuumPattern,
  getExtendedOPattern,
  getComboPattern,
  listPatternNames,
  clearAllCustomPatterns,
} from "../src/tools/customPatterns.js";

describe("Custom Pattern Store", () => {
  beforeEach(() => {
    clearAllCustomPatterns();
  });

  // ─── Import validation ──────────────────────────────────────────────────────

  it("should throw for missing patternType", () => {
    expect(() =>
      importCustomPattern({ name: "cust1", keyframes: [{ duration: 500, value: 0.5 }] }),
    ).toThrow(/patternType/i);
  });

  it("should throw for invalid patternType", () => {
    expect(() =>
      importCustomPattern({
        patternType: "turbo",
        name: "cust1",
        keyframes: [{ duration: 500, value: 0.5 }],
      }),
    ).toThrow(/patternType/i);
  });

  it("should throw for missing name", () => {
    expect(() =>
      importCustomPattern({
        patternType: "piston",
        keyframes: [{ duration: 500, value: 0.5 }],
      }),
    ).toThrow(/name/i);
  });

  it("should throw for empty keyframes array in piston pattern", () => {
    expect(() =>
      importCustomPattern({ patternType: "piston", name: "cust1", keyframes: [] }),
    ).toThrow(/keyframes/i);
  });

  it("should throw for missing keyframes in piston pattern", () => {
    expect(() =>
      importCustomPattern({ patternType: "piston", name: "cust1" }),
    ).toThrow(/keyframes/i);
  });

  it("should throw for missing vibrationKeyframes in extendedO pattern", () => {
    expect(() =>
      importCustomPattern({
        patternType: "extendedO",
        name: "cust1",
        vacuumKeyframes: [{ duration: 500, value: 0.5 }],
      }),
    ).toThrow(/vibrationKeyframes/i);
  });

  it("should throw for missing vacuumKeyframes in combo pattern", () => {
    expect(() =>
      importCustomPattern({
        patternType: "combo",
        name: "cust1",
        vibrationKeyframes: [{ duration: 500, value: 0.5 }],
      }),
    ).toThrow(/vacuumKeyframes/i);
  });

  // ─── Successful imports ─────────────────────────────────────────────────────

  it("should import a valid piston pattern", () => {
    const result = importCustomPattern({
      patternType: "piston",
      name: "cust1",
      keyframes: [
        { duration: 200, value: 0.3 },
        { duration: 200, value: 0.7 },
      ],
    });
    expect(result.patternType).toBe("piston");
    expect(result.name).toBe("cust1");
  });

  it("should import a valid vacuum pattern", () => {
    const result = importCustomPattern({
      patternType: "vacuum",
      name: "cust1",
      keyframes: [
        { duration: 500, value: 0.5, easing: "step" },
        { duration: 500, value: 0, easing: "step" },
      ],
    });
    expect(result.patternType).toBe("vacuum");
    expect(result.name).toBe("cust1");
  });

  it("should import a valid extendedO pattern", () => {
    const result = importCustomPattern({
      patternType: "extendedO",
      name: "cust1",
      vibrationKeyframes: [{ duration: 2000, value: 0.1 }],
      vacuumKeyframes: [{ duration: 2000, value: 0.1 }],
    });
    expect(result.patternType).toBe("extendedO");
    expect(result.name).toBe("cust1");
  });

  it("should import a valid combo pattern", () => {
    const result = importCustomPattern({
      patternType: "combo",
      name: "cust1",
      vibrationKeyframes: [{ duration: 1000, value: 0.5 }],
      vacuumKeyframes: [{ duration: 1000, value: 0.4 }],
    });
    expect(result.patternType).toBe("combo");
    expect(result.name).toBe("cust1");
  });

  // ─── Per-tool isolation ─────────────────────────────────────────────────────

  it("should store piston and vacuum patterns with the same name in separate arrays", () => {
    importCustomPattern({
      patternType: "piston",
      name: "cust1",
      keyframes: [{ duration: 300, value: 0.8 }],
    });
    importCustomPattern({
      patternType: "vacuum",
      name: "cust1",
      keyframes: [{ duration: 600, value: 0.4 }],
    });

    const pistonPat = getPistonPattern("cust1");
    const vacuumPat = getVacuumPattern("cust1");

    expect(pistonPat).toBeDefined();
    expect(vacuumPat).toBeDefined();
    // They are separate objects with different definitions
    expect(pistonPat!.keyframes[0].duration).toBe(300);
    expect(vacuumPat!.keyframes[0].duration).toBe(600);
  });

  it("should not cross-contaminate combo and extendedO stores", () => {
    importCustomPattern({
      patternType: "combo",
      name: "shared",
      vibrationKeyframes: [{ duration: 1000, value: 0.5 }],
      vacuumKeyframes: [{ duration: 1000, value: 0.3 }],
    });

    // extendedO store must not have "shared"
    expect(getExtendedOPattern("shared")).toBeUndefined();
    // combo store must have "shared"
    expect(getComboPattern("shared")).toBeDefined();
  });

  it("should not affect other tool stores when importing piston pattern", () => {
    importCustomPattern({
      patternType: "piston",
      name: "onlyPiston",
      keyframes: [{ duration: 500, value: 0.5 }],
    });

    expect(getPistonPattern("onlyPiston")).toBeDefined();
    expect(getVacuumPattern("onlyPiston")).toBeUndefined();
    expect(getExtendedOPattern("onlyPiston")).toBeUndefined();
    expect(getComboPattern("onlyPiston")).toBeUndefined();
  });

  it("should allow overwriting a pattern with the same name in the same tool", () => {
    importCustomPattern({
      patternType: "vacuum",
      name: "myPattern",
      keyframes: [{ duration: 200, value: 0.2 }],
    });
    importCustomPattern({
      patternType: "vacuum",
      name: "myPattern",
      keyframes: [{ duration: 400, value: 0.8 }],
    });

    const pat = getVacuumPattern("myPattern");
    expect(pat!.keyframes[0].duration).toBe(400);
    expect(pat!.keyframes[0].value).toBe(0.8);
  });

  // ─── listPatternNames ───────────────────────────────────────────────────────

  it("should list all pattern names for each tool type independently", () => {
    importCustomPattern({
      patternType: "piston",
      name: "p1",
      keyframes: [{ duration: 100, value: 0.5 }],
    });
    importCustomPattern({
      patternType: "piston",
      name: "p2",
      keyframes: [{ duration: 100, value: 0.6 }],
    });
    importCustomPattern({
      patternType: "vacuum",
      name: "v1",
      keyframes: [{ duration: 100, value: 0.5 }],
    });

    expect(listPatternNames("piston")).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(listPatternNames("piston")).toHaveLength(2);
    expect(listPatternNames("vacuum")).toEqual(["v1"]);
    expect(listPatternNames("extendedO")).toHaveLength(0);
    expect(listPatternNames("combo")).toHaveLength(0);
  });

  // ─── clearAllCustomPatterns ─────────────────────────────────────────────────

  it("should clear all patterns across all tools", () => {
    importCustomPattern({
      patternType: "piston",
      name: "p1",
      keyframes: [{ duration: 100, value: 0.5 }],
    });
    importCustomPattern({
      patternType: "vacuum",
      name: "v1",
      keyframes: [{ duration: 100, value: 0.5 }],
    });

    clearAllCustomPatterns();

    expect(getPistonPattern("p1")).toBeUndefined();
    expect(getVacuumPattern("v1")).toBeUndefined();
  });

  // ─── Input validation edge cases ────────────────────────────────────────────

  it("should trim whitespace from pattern name", () => {
    importCustomPattern({
      patternType: "piston",
      name: "  myPattern  ",
      keyframes: [{ duration: 100, value: 0.5 }],
    });
    expect(getPistonPattern("myPattern")).toBeDefined();
    expect(getPistonPattern("  myPattern  ")).toBeUndefined();
  });

  it("should reject non-object input", () => {
    expect(() => importCustomPattern("not an object")).toThrow(/JSON object/i);
    expect(() => importCustomPattern(null)).toThrow(/JSON object/i);
    expect(() => importCustomPattern(42)).toThrow(/JSON object/i);
  });

  it("should reject a keyframe with missing duration", () => {
    expect(() =>
      importCustomPattern({
        patternType: "piston",
        name: "bad",
        keyframes: [{ value: 0.5 }],
      }),
    ).toThrow(/keyframes/i);
  });

  it("should reject a keyframe with missing value", () => {
    expect(() =>
      importCustomPattern({
        patternType: "vacuum",
        name: "bad",
        keyframes: [{ duration: 500 }],
      }),
    ).toThrow(/keyframes/i);
  });
});
