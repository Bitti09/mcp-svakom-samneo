import { type Keyframe } from "@zendrex/buttplug.js";

/**
 * Supported pattern tool types.
 */
export type PatternType = "piston" | "extendedO" | "vacuum" | "combo";

/**
 * A custom piston pattern (single vibration track).
 */
export interface PistonCustomPattern {
  patternType: "piston";
  name: string;
  keyframes: Keyframe[];
}

/**
 * A custom vacuum pattern (single vacuum track).
 */
export interface VacuumCustomPattern {
  patternType: "vacuum";
  name: string;
  keyframes: Keyframe[];
}

/**
 * A custom extendedO pattern (dual vibration + vacuum tracks).
 */
export interface ExtendedOCustomPattern {
  patternType: "extendedO";
  name: string;
  vibrationKeyframes: Keyframe[];
  vacuumKeyframes: Keyframe[];
}

/**
 * A custom combo pattern (dual vibration + vacuum tracks).
 */
export interface ComboCustomPattern {
  patternType: "combo";
  name: string;
  vibrationKeyframes: Keyframe[];
  vacuumKeyframes: Keyframe[];
}

export type CustomPattern =
  | PistonCustomPattern
  | VacuumCustomPattern
  | ExtendedOCustomPattern
  | ComboCustomPattern;

/**
 * Per-tool custom pattern stores.
 * Each tool has its own isolated map so the same name (e.g. "cust1") can have
 * different definitions per tool without cross-tool interference.
 */
const pistonPatterns = new Map<string, PistonCustomPattern>();
const vacuumPatterns = new Map<string, VacuumCustomPattern>();
const extendedOPatterns = new Map<string, ExtendedOCustomPattern>();
const comboPatterns = new Map<string, ComboCustomPattern>();

function getStoreForType(type: PatternType): Map<string, CustomPattern> {
  switch (type) {
    case "piston":
      return pistonPatterns as Map<string, CustomPattern>;
    case "vacuum":
      return vacuumPatterns as Map<string, CustomPattern>;
    case "extendedO":
      return extendedOPatterns as Map<string, CustomPattern>;
    case "combo":
      return comboPatterns as Map<string, CustomPattern>;
  }
}

function isValidKeyframe(kf: unknown): kf is Keyframe {
  if (typeof kf !== "object" || kf === null) return false;
  const k = kf as Record<string, unknown>;
  return (
    typeof k.duration === "number" &&
    typeof k.value === "number"
  );
}

function isValidKeyframes(arr: unknown): arr is Keyframe[] {
  return Array.isArray(arr) && arr.length > 0 && arr.every(isValidKeyframe);
}

/**
 * Validates and imports a custom pattern JSON object.
 * The `patternType` field is required and must match a supported tool type.
 * The pattern is stored only in the matching tool's isolated store.
 *
 * @throws {Error} if patternType is missing/invalid, name is missing, or keyframes are invalid.
 */
export function importCustomPattern(raw: unknown): CustomPattern {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Pattern must be a JSON object.");
  }

  const obj = raw as Record<string, unknown>;

  const { patternType, name } = obj;

  if (
    patternType !== "piston" &&
    patternType !== "vacuum" &&
    patternType !== "extendedO" &&
    patternType !== "combo"
  ) {
    throw new Error(
      `Invalid or missing patternType "${String(patternType)}". ` +
        `Must be one of: piston, extendedO, vacuum, combo.`,
    );
  }

  if (typeof name !== "string" || name.trim() === "") {
    throw new Error('Pattern must have a non-empty "name" string field.');
  }

  const trimmedName = name.trim();

  if (patternType === "piston") {
    if (!isValidKeyframes(obj.keyframes)) {
      throw new Error(
        'Piston pattern requires a non-empty "keyframes" array with {duration, value} objects.',
      );
    }
    const pattern: PistonCustomPattern = {
      patternType: "piston",
      name: trimmedName,
      keyframes: obj.keyframes as Keyframe[],
    };
    pistonPatterns.set(trimmedName, pattern);
    return pattern;
  }

  if (patternType === "vacuum") {
    if (!isValidKeyframes(obj.keyframes)) {
      throw new Error(
        'Vacuum pattern requires a non-empty "keyframes" array with {duration, value} objects.',
      );
    }
    const pattern: VacuumCustomPattern = {
      patternType: "vacuum",
      name: trimmedName,
      keyframes: obj.keyframes as Keyframe[],
    };
    vacuumPatterns.set(trimmedName, pattern);
    return pattern;
  }

  if (patternType === "extendedO") {
    if (!isValidKeyframes(obj.vibrationKeyframes)) {
      throw new Error(
        'ExtendedO pattern requires a non-empty "vibrationKeyframes" array.',
      );
    }
    if (!isValidKeyframes(obj.vacuumKeyframes)) {
      throw new Error(
        'ExtendedO pattern requires a non-empty "vacuumKeyframes" array.',
      );
    }
    const pattern: ExtendedOCustomPattern = {
      patternType: "extendedO",
      name: trimmedName,
      vibrationKeyframes: obj.vibrationKeyframes as Keyframe[],
      vacuumKeyframes: obj.vacuumKeyframes as Keyframe[],
    };
    extendedOPatterns.set(trimmedName, pattern);
    return pattern;
  }

  // combo
  if (!isValidKeyframes(obj.vibrationKeyframes)) {
    throw new Error(
      'Combo pattern requires a non-empty "vibrationKeyframes" array.',
    );
  }
  if (!isValidKeyframes(obj.vacuumKeyframes)) {
    throw new Error(
      'Combo pattern requires a non-empty "vacuumKeyframes" array.',
    );
  }
  const pattern: ComboCustomPattern = {
    patternType: "combo",
    name: trimmedName,
    vibrationKeyframes: obj.vibrationKeyframes as Keyframe[],
    vacuumKeyframes: obj.vacuumKeyframes as Keyframe[],
  };
  comboPatterns.set(trimmedName, pattern);
  return pattern;
}

/**
 * Retrieves a custom piston pattern by name.
 */
export function getPistonPattern(
  name: string,
): PistonCustomPattern | undefined {
  return pistonPatterns.get(name);
}

/**
 * Retrieves a custom vacuum pattern by name.
 */
export function getVacuumPattern(
  name: string,
): VacuumCustomPattern | undefined {
  return vacuumPatterns.get(name);
}

/**
 * Retrieves a custom extendedO pattern by name.
 */
export function getExtendedOPattern(
  name: string,
): ExtendedOCustomPattern | undefined {
  return extendedOPatterns.get(name);
}

/**
 * Retrieves a custom combo pattern by name.
 */
export function getComboPattern(
  name: string,
): ComboCustomPattern | undefined {
  return comboPatterns.get(name);
}

/**
 * Returns all stored pattern names for a given tool type.
 */
export function listPatternNames(type: PatternType): string[] {
  return Array.from(getStoreForType(type).keys());
}

/**
 * Clears all custom patterns (used in tests).
 */
export function clearAllCustomPatterns(): void {
  pistonPatterns.clear();
  vacuumPatterns.clear();
  extendedOPatterns.clear();
  comboPatterns.clear();
}
