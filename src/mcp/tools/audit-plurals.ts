import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditPlurals } from "../../core/plural/cldr-linter.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const auditPluralsSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  locales: z
    .array(z.string())
    .optional()
    .describe("Optional target locales to audit (e.g. ['ar', 'ru', 'pl', 'fr']). Defaults to all detected locales."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to limit plural auditing to."),
  fix: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, automatically scaffolds missing required CLDR plural forms and 'other' fallback branches."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default when fix is true), previews changes via unified diff without modifying files."),
};

export function registerAuditPluralsTool(server: McpServer): void {
  server.tool(
    "audit_plurals",
    "Audits translation catalogs (JSON and Flutter ARB) against official Unicode CLDR plural and gender rules, detecting missing mandatory categories (e.g., Arabic zero/two/few/many, Russian few/many), missing 'other' fallback branches, and variable mismatches, with automated scaffold fixing.",
    auditPluralsSchema,
    async ({ projectPath, locales, namespaces, fix, dryRun }) => {
      logger.info(
        `Invoking audit_plurals (projectPath=${projectPath}, fix=${fix}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await auditPlurals({
          projectPath: root,
          locales,
          namespaces,
          fix,
          dryRun,
        });

        const summaryLines = [
          `# Unicode CLDR Plural & Gender Rules Audit`,
          ``,
          `Status: ${result.totalIssues === 0 ? "COMPLIANT" : "ISSUES DETECTED"}`,
          `Catalogs Audited: ${result.totalCatalogs}`,
          `Plural Clauses Audited: ${result.totalPluralsAudited}`,
          `Total Issues: ${result.totalIssues}`,
          `- Missing CLDR Categories: ${result.missingCategoriesCount}`,
          `- Missing 'other' Fallback Branches: ${result.missingOtherFallbackCount}`,
          `- Invalid Categories: ${result.invalidCategoriesCount}`,
        ];

        if (fix) {
          summaryLines.push(
            `Fix Mode: ${result.fixesApplied !== undefined && !dryRun ? "APPLIED TO DISK" : "DRY-RUN (Simulated)"}`,
            `Fixes Applied: ${result.fixesApplied || 0}`,
            `Files Affected: ${result.filesAffected.length}`
          );
        }

        if (result.issues.length > 0) {
          summaryLines.push(``, `## Plural Issues (${result.issues.length}):`);
          for (const issue of result.issues.slice(0, 30)) {
            const fixableTag = issue.autoFixable ? " [Auto-Fixable]" : "";
            summaryLines.push(
              `- **[${issue.severity.toUpperCase()}]** \`${issue.file}\` (${issue.format}) -> Key: \`${issue.key}\`${fixableTag}`,
              `  ${issue.message}`
            );
          }
          if (result.issues.length > 30) {
            summaryLines.push(`  ... and ${result.issues.length - 30} more issue(s)`);
          }
        }

        if (result.diff) {
          summaryLines.push(``, `## Auto-Fix Unified Diff:`, `\`\`\`diff`, result.diff, `\`\`\``);
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
        logger.error("audit_plurals tool failed:", error);
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
                  code: "PLURAL_AUDIT_FAILED",
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
