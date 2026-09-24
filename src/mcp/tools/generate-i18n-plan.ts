import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateI18nPlan } from "../../core/planning/plan-generator.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const generateI18nPlanSchema = {
  projectPath: z
    .string()
    .optional()
    .describe(
      "Optional path to the project root directory. Defaults to the current working directory."
    ),
  path: z
    .string()
    .optional()
    .describe("Alias for projectPath."),
  scope: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Optional scope: file path, directory path, glob pattern, or an array of them to limit planning."
    ),
  include: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns to include for planning."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns to exclude from planning."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source locale (e.g. 'en'). Defaults to the project's detected source locale."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target locales (e.g. ['fr', 'es']). Defaults to project's detected target locales."),
  confidenceThreshold: z
    .number()
    .optional()
    .default(0.7)
    .describe("Minimum confidence score (0.0 to 1.0) below which candidates are marked for REVIEW."),
  includeAmbiguous: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include ambiguous low-confidence candidates in the plan for review."),
  candidateDecisions: z
    .record(z.boolean())
    .optional()
    .describe(
      "Optional map of candidate ID (or text) to boolean decision (true = include as user-facing, false = skip as technical) for resolving ambiguous strings."
    ),
};

export function registerGenerateI18nPlanTool(server: McpServer): void {
  server.tool(
    "generate_i18n_plan",
    "Analyze detected hardcoded user-facing strings and produce a complete, deterministic, reviewable i18n migration plan (translations, source code changes, and required hooks/imports) with zero filesystem mutations.",
    generateI18nPlanSchema,
    async ({
      projectPath,
      path: pathAlias,
      scope,
      include,
      exclude,
      sourceLocale,
      targetLocales,
      confidenceThreshold,
      includeAmbiguous,
      candidateDecisions,
    }) => {
      const targetPath = pathAlias || projectPath;
      logger.info(`Invoking generate_i18n_plan for path: ${targetPath || "."}`);
      try {
        const plan = await generateI18nPlan({
          projectPath: targetPath,
          scope,
          include,
          exclude,
          sourceLocale,
          targetLocales,
          confidenceThreshold: confidenceThreshold ?? 0.7,
          includeAmbiguous: includeAmbiguous ?? false,
          candidateDecisions,
        });

        // Generate concise human-readable summary
        const summaryText = [
          `# i18n Migration Plan`,
          ``,
          `Project: ${plan.project.root} (${plan.project.framework}, ${plan.project.library || "none"})`,
          `Locales: source=${plan.locales.source}, targets=[${plan.locales.targets.join(", ")}]`,
          ``,
          `## Summary`,
          `- Total detected: ${plan.summary.totalDetected}`,
          `- User-facing strings: ${plan.summary.userFacingCount}`,
          `- Ignored (technical): ${plan.summary.ignoredCount}`,
          `- Existing keys reused: ${plan.summary.reusedKeysCount}`,
          `- New keys to create: ${plan.summary.newKeysCount}`,
          `- Requires review: ${plan.summary.requiresReviewCount}`,
          `- Source files affected: ${plan.summary.sourceFilesAffected}`,
          `- Locale files affected: ${plan.summary.localeFilesAffected}`,
          ``,
          `## Proposed Translations (${plan.translations.length})`,
          ...plan.translations.map(
            (t) =>
              `- [${t.action}] ${t.namespace}:${t.key} ("${t.sourceText}")` +
              (t.matchType && t.matchType !== "NONE"
                ? ` [Match: ${t.matchType}${t.matchConfidence ? ` ${Math.round(t.matchConfidence * 100)}%` : ""}]`
                : "") +
              (t.occurrences > 1 ? ` (${t.occurrences} occurrences)` : "")
          ),
          ``,
          `## Source Changes (${plan.sourceChanges.length})`,
          ...plan.sourceChanges.slice(0, 15).map(
            (s) =>
              `- [${s.action}] ${s.file}:${s.location.line}:${s.location.column} -> ${s.replacement}` +
              (s.requiredCodeChanges?.length
                ? ` (Requires: ${s.requiredCodeChanges.map((c) => c.value).join(", ")})`
                : "")
          ),
          ...(plan.sourceChanges.length > 15
            ? [`- ... and ${plan.sourceChanges.length - 15} more source change(s)`]
            : []),
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: `${summaryText}\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``,
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("generate_i18n_plan tool failed:", error);
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
                  code: "UNKNOWN_ERROR",
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
