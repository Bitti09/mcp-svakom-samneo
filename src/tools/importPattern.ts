import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { importCustomPattern, listPatternNames } from "./customPatterns.js";
import { errorLog } from "../utils/logger.js";

/**
 * Registers the ImportPattern tool with the MCP server.
 * Accepts a custom pattern JSON string, validates the patternType, and stores it
 * in the correct per-tool pattern array.
 */
export function createImportPatternTools(server: McpServer) {
  server.tool(
    "Svakom-Sam-Neo-ImportPattern",
    "Imports a custom stimulation pattern into the server. The JSON must contain a required top-level \"patternType\" field (piston | extendedO | vacuum | combo) so the pattern is stored in the correct tool's isolated array. The same pattern name can exist with different definitions per tool (e.g. a \"cust1\" piston pattern is separate from a \"cust1\" vacuum pattern).",
    {
      patternJson: z
        .string()
        .describe(
          'JSON string describing the custom pattern. Must include "patternType" (piston|extendedO|vacuum|combo) and "name". ' +
            'Piston/Vacuum patterns also need "keyframes" (array of {duration, value, easing?}). ' +
            'ExtendedO/Combo patterns need "vibrationKeyframes" and "vacuumKeyframes".',
        ),
    },
    async ({ patternJson }) => {
      try {
        const raw: unknown = JSON.parse(patternJson);
        const imported = importCustomPattern(raw);

        const storedNames = listPatternNames(imported.patternType);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  patternType: imported.patternType,
                  name: imported.name,
                  message: `Pattern "${imported.name}" imported for tool "${imported.patternType}".`,
                  allPatternsForType: storedNames,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        errorLog("ImportPatternTool", "Failed to import pattern:", e);
        return {
          content: [
            {
              type: "text",
              text: `Error importing pattern: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
