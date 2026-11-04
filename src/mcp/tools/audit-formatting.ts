import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditFormatting } from "../../core/formatting/formatting-auditor.js";
import type { FormattingIssueCategory } from "../../models/formatting.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const auditFormattingSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  scope: z
    .array(z.string())
    .optional()
    .describe("Optional list of relative paths, files, or folders to limit formatting audit to."),
  include: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns of files to include in formatting audit."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns of files to exclude from formatting audit."),
  categories: z
    .array(z.enum(["CURRENCY", "NUMBER", "PERCENTAGE", "DATE", "TIME"]))
    .optional()
    .describe("Categories to audit: 'CURRENCY', 'NUMBER', 'PERCENTAGE', 'DATE', 'TIME'. Defaults to all."),
  fix: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, automatically fixes formatting issues using Intl or Flutter formatters."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default when fix is true), previews changes via unified diff without modifying files."),
};

export function registerAuditFormattingTool(server: McpServer): void {
  server.tool(
    "audit_formatting",
    "Audits project source code (React, React Native, Vue, Flutter) for hardcoded currency concatenations, unlocalized numbers (.toFixed()), raw percentage signs, and unparameterized date/time calls (.toLocaleDateString()), with automated logical migration using Intl or package:intl.",
    auditFormattingSchema,
    async ({ projectPath, scope, include, exclude, categories, fix, dryRun }) => {
      logger.info(
        `Invoking audit_formatting (projectPath=${projectPath}, fix=${fix}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await auditFormatting({
          projectPath: root,
          scope,
          include,
          exclude,
          categories: categories as FormattingIssueCategory[] | undefined,
          fix,
          dryRun,
        });

        const summaryLines = [
          `# Number, Date & Currency Formatting Audit`,
          ``,
          `Status: ${result.totalIssues === 0 ? "COMPLIANT" : "ISSUES DETECTED"}`,
          `Framework: ${result.framework}`,
          `Total Issues: ${result.totalIssues}`,
          `- Currency Concatenations: ${result.currencyIssuesCount}`,
          `- Unlocalized Decimals (.toFixed): ${result.numberIssuesCount}`,
          `- Hardcoded Percentages (%): ${result.percentageIssuesCount}`,
          `- Date Formatting Issues: ${result.dateIssuesCount}`,
          `- Time Formatting Issues: ${result.timeIssuesCount || 0}`,
          `Auto-Fixable Issues: ${result.fixableCount}`,
        ];

        if (fix) {
          summaryLines.push(
            `Fix Mode: ${result.fixesApplied !== undefined && !dryRun ? "APPLIED TO DISK" : "DRY-RUN (Simulated)"}`,
            `Fixes Applied: ${result.fixesApplied || 0}`,
            `Files Affected: ${result.filesAffected.length}`
          );
        }

        if (result.issues.length > 0) {
          summaryLines.push(``, `## Formatting Issues (${result.issues.length}):`);
          for (const issue of result.issues.slice(0, 30)) {
            const fixableTag = issue.autoFixable ? " [Auto-Fixable]" : "";
            summaryLines.push(
              `- **[${issue.category}]** \`${issue.file}:${issue.line}:${issue.column}\`${fixableTag}`,
              `  Expression: \`${issue.rawExpression}\``,
              `  Message: ${issue.message}`,
              issue.suggestedReplacement ? `  Suggested Replacement: \`${issue.suggestedReplacement}\`` : ""
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
              text: summaryLines.filter(Boolean).join("\n"),
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("audit_formatting tool failed:", error);
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
                  code: "FORMATTING_AUDIT_FAILED",
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
