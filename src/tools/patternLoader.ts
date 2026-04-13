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
    `Fetches a custom pattern JSON from a URL, validates it against the JET schema ({ name, description, tracks: [{ featureIndex, keyframes: [{ value, duration, easing? }], outputType?, clockwise? }], intensity?, loop? }), and registers it for use with other tools via the 'customPattern' parameter. Returns the full updated list of available custom patterns on success.`,
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

      const result = PatternEntrySchema.safeParse(json);
      if (!result.success) {
        const errors = result.error.errors
          .map((err) => `  - ${err.path.join(".") || "(root)"}: ${err.message}`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Pattern validation failed (JET schema):\n${errors}` }],
          isError: true,
        };
      }

      const pattern = result.data;

      if (getPattern(pattern.name)) {
        return {
          content: [
            {
              type: "text",
              text: `A pattern named "${pattern.name}" is already loaded. Use a different name or restart the server to clear the registry.`,
            },
          ],
          isError: true,
        };
      }

      registerPattern(pattern);
      debugLog("PatternLoader", `Registered custom pattern: ${pattern.name}`);

      return {
        content: [
          {
            type: "text",
            text: `✅ Custom pattern "${pattern.name}" loaded successfully.\n\nAvailable custom patterns:\n${formatPatternList()}`,
          },
        ],
      };
    },
  );
}
