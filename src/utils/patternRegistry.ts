import { z } from "zod";
import type { CustomPattern } from "@zendrex/buttplug.js";

/**
 * Easing functions supported by the pattern engine.
 * Mirrors the library's Easing type exactly.
 */
const EasingSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "step"]);

/**
 * Single animation keyframe — mirrors the library's Keyframe type.
 * `value` is intensity (0–1), `duration` is milliseconds.
 */
const KeyframeSchema = z.object({
  value: z.number().min(0).max(1),
  duration: z.number().min(0),
  easing: EasingSchema.optional(),
});

/**
 * Output types supported by the pattern engine.
 * Mirrors the library's OutputType enum exactly.
 */
const OutputTypeSchema = z.enum([
  "Vibrate",
  "Rotate",
  "RotateWithDirection",
  "Oscillate",
  "Constrict",
  "Spray",
  "Temperature",
  "Led",
  "Position",
  "HwPositionWithDuration",
]);

/**
 * A single pattern track bound to a device feature — mirrors the library's Track type.
 */
const TrackSchema = z.object({
  featureIndex: z.number().int().min(0),
  keyframes: z.array(KeyframeSchema).min(1),
  clockwise: z.boolean().optional(),
  outputType: OutputTypeSchema.optional(),
});

/**
 * JET validation schema for user-provided custom patterns.
 *
 * The body (`type`, `tracks`, `intensity`, `loop`) is structurally identical to the
 * library's own `CustomPattern` / `PatternDescriptor` format so that validated entries
 * can be passed directly to `engine.play()` after stripping `name` and `description`.
 */
export const PatternEntrySchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase kebab-case (e.g. slow-build)"),
  description: z.string().min(1),
  // --- everything below mirrors the library's CustomPattern exactly ---
  type: z.literal("custom"),
  tracks: z.array(TrackSchema).min(1),
  intensity: z.number().min(0).max(1).optional(),
  loop: z.union([z.boolean(), z.number()]).optional(),
});

export type PatternEntry = z.infer<typeof PatternEntrySchema>;

// ---------------------------------------------------------------------------
// In-memory registry (resets on server restart by design)
// ---------------------------------------------------------------------------

const registry = new Map<string, PatternEntry>();

export function registerPattern(pattern: PatternEntry): void {
  registry.set(pattern.name, pattern);
}

export function getPattern(name: string): PatternEntry | undefined {
  return registry.get(name);
}

export function listPatterns(): Array<{ name: string; description: string }> {
  return Array.from(registry.values()).map((p) => ({
    name: p.name,
    description: p.description,
  }));
}

export function formatPatternList(): string {
  const patterns = listPatterns();
  if (patterns.length === 0) return "No custom patterns loaded.";
  return patterns.map((p) => `• ${p.name}: ${p.description}`).join("\n");
}

/**
 * Strips `name` and `description` from a registry entry and returns the
 * bare `CustomPattern` descriptor ready for `engine.play()`.
 */
export function toDescriptor(entry: PatternEntry): CustomPattern {
  return {
    type: entry.type,
    tracks: entry.tracks,
    intensity: entry.intensity,
    loop: entry.loop,
  } as CustomPattern;
}
