import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditDuplicates } from "../../core/deduplication/deduplication-engine.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const deduplicateI18nSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source language code (e.g. 'en'). Defaults to detected source locale."),
  similarityThreshold: z
    .number()
    .min(0.5)
    .max(1.0)
    .optional()
    .default(0.85)
    .describe("Fuzzy similarity threshold between 0.5 and 1.0 (defaults to 0.85)."),
  exactOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only report exact duplicate strings across keys or namespaces."),
  crossNamespaceOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only report strings duplicated across multiple feature namespaces."),
  targetNamespace: z
    .string()
    .optional()
    .default("common")
    .describe("Target namespace to consolidate shared strings into. Defaults to 'common'."),
  consolidate: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, automatically consolidates redundant keys into canonical shared keys across all catalogs and source code references."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default when consolidate is true), previews consolidation diff without modifying files."),
  scope: z
    .array(z.string())
    .optional()
    .describe("Optional list of files or folders to limit code reference updating to."),
};

export function registerDeduplicateI18nTool(server: McpServer): void {
  server.tool(
    "deduplicate_i18n",
    "Detects exact duplicate translation keys, fuzzy near-duplicates, and cross-namespace redundancy across project catalogs using normalized Levenshtein similarity, with optional automated key consolidation and source code call-site updates.",
    deduplicateI18nSchema,
    async ({
      projectPath,
      sourceLocale,
      similarityThreshold,
      exactOnly,
      crossNamespaceOnly,
      targetNamespace,
      consolidate,
      dryRun,
      scope,
    }) => {
      logger.info(
        `Invoking deduplicate_i18n (projectPath=${projectPath}, threshold=${similarityThreshold}, consolidate=${consolidate})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await auditDuplicates({
          projectPath: root,
          sourceLocale,
          similarityThreshold,
          exactOnly,
          crossNamespaceOnly,
          targetNamespace,
          consolidate,
          dryRun,
          scope,
        });

        const totalDuplicates =
          result.exactDuplicatesCount +
          result.fuzzyDuplicatesCount +
          result.crossNamespaceDuplicatesCount;

        const summaryLines = [
          `# Translation Deduplication & Similarity Audit`,
          ``,
          `Status: ${totalDuplicates === 0 ? "OPTIMIZED (No Duplicates)" : "REDUNDANCY DETECTED"}`,
          `Source Locale: ${result.sourceLocale}`,
          `Total Keys Scanned: ${result.totalKeysScanned}`,
          `- Exact Duplicates: ${result.exactDuplicatesCount}`,
          `- Cross-Namespace Duplicates: ${result.crossNamespaceDuplicatesCount}`,
          `- Fuzzy Near-Duplicates: ${result.fuzzyDuplicatesCount}`,
          `Duplicate Clusters: ${result.clusters.length}`,
        ];

        if (consolidate) {
          summaryLines.push(
            `Consolidation Mode: ${result.keysConsolidated !== undefined && !dryRun ? "APPLIED TO DISK" : "DRY-RUN (Simulated)"}`,
            `Keys Consolidated: ${result.keysConsolidated || 0}`,
            `Files Affected: ${result.filesModified?.length || 0}`
          );
        }

        if (result.clusters.length > 0) {
          summaryLines.push(``, `## Duplicate Clusters (${result.clusters.length}):`);
          for (const c of result.clusters.slice(0, 20)) {
            summaryLines.push(
              `- **"${c.value}"** (${c.totalOccurrences} occurrences) -> Canonical: \`${c.canonicalNamespace}.${c.canonicalKey}\``,
              `  Keys: ${c.keys.map((k) => `\`${k.namespace}.${k.key}\``).join(", ")}`
            );
          }
          if (result.clusters.length > 20) {
            summaryLines.push(`  ... and ${result.clusters.length - 20} more cluster(s)`);
          }
        }

        if (result.matches.some((m) => m.matchType === "FUZZY")) {
          const fuzzyMatches = result.matches.filter((m) => m.matchType === "FUZZY");
          summaryLines.push(``, `## Fuzzy Near-Duplicates (${fuzzyMatches.length}):`);
          for (const m of fuzzyMatches.slice(0, 15)) {
            summaryLines.push(
              `- **[${Math.round(m.similarity * 100)}% Match]** \`${m.namespaceA}.${m.keyA}\` ("${m.valueA}") <-> \`${m.namespaceB}.${m.keyB}\` ("${m.valueB}")`,
              `  Recommendation: Consolidate to \`${m.canonicalRecommendation}\``
            );
          }
        }

        if (result.diff) {
          summaryLines.push(``, `## Consolidation Unified Diff:`, `\`\`\`diff`, result.diff, `\`\`\``);
        }

        return {
          content: [
            {
              type: "text",
              text: summaryLines.join("\n"),
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("deduplicate_i18n tool failed:", error);
        if (error instanceof I18nMcpError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(error.toJSON(), null, 2),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  code: "DEDUPLICATION_FAILED",
                  message: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
