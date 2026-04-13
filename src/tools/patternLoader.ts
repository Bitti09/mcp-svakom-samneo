import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  PatternEntrySchema,
  formatPatternList,
  getPattern,
  registerPattern,
} from "../utils/patternRegistry.js";
import { debugLog, errorLog } from "../utils/logger.js";

/**
 * Names that are reserved for built-in operation modes across the three motion tools.
 * Custom patterns must not claim these names to avoid confusion with internal parameters.
 *
 * Vacuum `pattern` values:   constant | pulse | wave
 * Combo  `syncMode` values:  synchronized | alternating | independent
 * Combo  `vacuumPattern`:    constant | pulse | wave  (same set as Vacuum)
 */
const BLACKLISTED_PATTERN_NAMES: Record<string, string> = {
  "constant":     "Reserved name — used as the built-in 'constant' vacuum/combo mode.",
  "pulse":        "Reserved name — used as the built-in 'pulse' vacuum/combo mode.",
  "wave":         "Reserved name — used as the built-in 'wave' vacuum/combo mode.",
  "synchronized": "Reserved name — used as the built-in 'synchronized' combo sync-mode.",
  "alternating":  "Reserved name — used as the built-in 'alternating' combo sync-mode.",
  "independent":  "Reserved name — used as the built-in 'independent' combo sync-mode.",
};

/**
 * Registers the LoadPattern tool with the MCP server.
 *
 * The tool fetches a JSON file from a user-supplied URL, validates it against
 * the JET pattern schema (which mirrors the library's Track[] shorthand plus
 * `name` and `description`), and adds it to the live in-memory registry.
 *
 * Schema summary for the JSON at the URL:
 * ```json
 * {
 *   "name": "slow-build",          // kebab-case identifier, must be unique
 *   "description": "Gradual ramp", // human-readable label
 *   "tracks": [                    // one entry per device feature
 *     {
 *       "featureIndex": 0,         // 0-based hardware feature index
 *       "outputType": "Vibrate",   // optional output type hint
 *       "keyframes": [
 *         { "value": 0, "duration": 0 },
 *         { "value": 0.8, "duration": 3000, "easing": "easeIn" }
 *       ]
 *     }
 *   ],
 *   "intensity": 0.8,              // optional global scaler (0–1)
 *   "loop": 3                      // optional: boolean or loop count
 * }
 * ```
 */
export function createPatternLoaderTool(server: McpServer) {
  server.tool(
    "Svakom-Sam-Neo-LoadPattern",
    `Fetches a custom pattern JSON from a URL, validates it against the JET schema ({ name, description, tracks: [{ featureIndex, keyframes: [{ value, duration, easing? }], outputType?, clockwise? }], intensity?, loop? }), and registers it for use with other tools via the 'customPattern' parameter. Accepts either a single pattern object or an array of pattern objects. Already-loaded names are skipped. Reserved internal names (constant, pulse, wave, synchronized, alternating, independent) are rejected with a reason. Returns the full updated list of available custom patterns on success.`,
    {
      url: z.string().url().describe("HTTP(S) URL pointing to the custom pattern JSON file."),
    },
    async ({ url }) => {
      debugLog("PatternLoader", `Fetching pattern from: ${url}`);

      let json: unknown;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        json = await response.json();
      } catch (e) {
        errorLog("PatternLoader", "Failed to fetch or parse pattern:", e);
        return {
          content: [{ type: "text", text: `Error fetching pattern from URL: ${e}` }],
          isError: true,
        };
      }

      // Accept either a single pattern object or an array of pattern objects.
      const singleResult = PatternEntrySchema.safeParse(json);
      const arrayResult = singleResult.success
        ? null
        : z.array(PatternEntrySchema).min(1).safeParse(json);

      if (!singleResult.success && !arrayResult?.success) {
        // Prefer the single-object error message as it is more actionable.
        const errors = singleResult.error.errors
          .map((err) => `  - ${err.path.join(".") || "(root)"}: ${err.message}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Pattern validation failed (JET schema):\n${errors}` }],
          isError: true,
        };
      }

      const patterns = singleResult.success
        ? [singleResult.data]
        : arrayResult!.data!;

      const loaded: string[] = [];
      const skipped: string[] = [];
      const blocked: Array<{ name: string; reason: string }> = [];

      for (const pattern of patterns) {
        const blacklistReason = BLACKLISTED_PATTERN_NAMES[pattern.name];
        if (blacklistReason !== undefined) {
          blocked.push({ name: pattern.name, reason: blacklistReason });
        } else if (getPattern(pattern.name)) {
          skipped.push(pattern.name);
        } else {
          registerPattern(pattern);
          debugLog("PatternLoader", `Registered custom pattern: ${pattern.name}`);
          loaded.push(pattern.name);
        }
      }

      const lines: string[] = [];
      if (blocked.length > 0) {
        const blockedLines = blocked
          .map(({ name, reason }) => `  • "${name}": ${reason}`)
          .join("\n");
        lines.push(`🚫 ${blocked.length} pattern(s) use reserved names and were rejected:\n${blockedLines}`);
      }
      if (loaded.length > 0) {
        lines.push(`✅ Loaded ${loaded.length} pattern(s): ${loaded.map((n) => `"${n}"`).join(", ")}.`);
      }
      if (skipped.length > 0) {
        lines.push(`⚠️ Skipped ${skipped.length} already-loaded pattern(s): ${skipped.map((n) => `"${n}"`).join(", ")}.`);
      }
      lines.push(`\nAvailable custom patterns:\n${formatPatternList()}`);

      // If every entry was blocked (no successes, no duplicates) treat it as an error
      // so the AI knows it must tell the user to rename their patterns.
      const allBlocked = blocked.length > 0 && loaded.length === 0 && skipped.length === 0;

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        ...(allBlocked ? { isError: true } : {}),
      };
    },
  );
}
