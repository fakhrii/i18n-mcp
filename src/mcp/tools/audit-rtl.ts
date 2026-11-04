import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditRtlLayout } from "../../core/rtl/rtl-auditor.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const auditRtlSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  scope: z
    .array(z.string())
    .optional()
    .describe("Optional list of files or directories to limit the RTL audit to."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target locales to evaluate for RTL support (e.g. ['ar', 'he', 'fa']). Defaults to detected target locales."),
  fix: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, automatically converts physical style and layout properties to logical directional equivalents."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default when fix is true), previews changes via unified diff without modifying files."),
};

export function registerAuditRtlTool(server: McpServer): void {
  server.tool(
    "audit_rtl",
    "Audits codebase for RTL (Right-to-Left) and bidirectional layout bugs, detecting physical spacing (marginLeft/Right), alignment (textAlign: left/right), directional icons, and missing RTL root configurations, with automated logical property migration.",
    auditRtlSchema,
    async ({ projectPath, scope, targetLocales, fix, dryRun }) => {
      logger.info(
        `Invoking audit_rtl (projectPath=${projectPath}, fix=${fix}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await auditRtlLayout({
          projectPath: root,
          scope,
          targetLocales,
          fix,
          dryRun,
        });

        const summaryLines = [
          `# RTL & Bidirectional Layout Audit`,
          ``,
          `Status: ${result.totalIssues === 0 ? "COMPLIANT" : "ISSUES DETECTED"}`,
          `RTL Locales Targeted: ${result.isRtlTargeted ? `YES [${result.rtlLocalesDetected.join(", ")}]` : "NO (Audited for general readiness)"}`,
          `Total Issues: ${result.totalIssues}`,
          `Auto-Fixable: ${result.fixableCount}`,
        ];

        if (fix) {
          summaryLines.push(
            `Fix Mode: ${result.fixesApplied !== undefined && !dryRun ? "APPLIED TO DISK" : "DRY-RUN (Simulated)"}`,
            `Files Affected: ${result.filesAffected.length}`
          );
        }

        if (result.issues.length > 0) {
          summaryLines.push(``, `## Detected RTL Issues (${result.issues.length}):`);
          for (const issue of result.issues.slice(0, 30)) {
            const fixableTag = issue.autoFixable ? " [Auto-Fixable]" : "";
            summaryLines.push(
              `- **[${issue.severity.toUpperCase()}]** \`${issue.file}:${issue.line}:${issue.column}\` (${issue.category})${fixableTag}`,
              `  ${issue.message}`,
              issue.suggestedReplacement ? `  *Suggested:* \`${issue.suggestedReplacement}\`` : ""
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
        logger.error("audit_rtl tool failed:", error);
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
                  code: "RTL_AUDIT_FAILED",
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
