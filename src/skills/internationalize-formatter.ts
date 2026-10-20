import type { InternationalizeResult } from "../models/internationalize.js";

/**
 * Formats an InternationalizeResult into a clear, agent-friendly Markdown report.
 */
export function formatInternationalizeResult(result: InternationalizeResult): string {
  const lines: string[] = [];

  switch (result.status) {
    case "NO_CHANGES":
      lines.push("### ✅ Codebase Already Internationalized");
      lines.push("");
      lines.push(
        "No hardcoded user-facing strings were detected in the requested scope. All strings are properly localized."
      );
      if (result.scope.length > 0) {
        lines.push(`- **Scope**: \`${result.scope.join("`, `")}\``);
      }
      lines.push(`- **Status**: \`${result.status}\``);
      return lines.join("\n");

    case "PLAN_READY":
      lines.push("### 📋 Internationalization Plan Ready (Preview Mode)");
      lines.push("");
      lines.push(
        "> ⚠️ **Dry-run**: No files have been modified. Review the plan below before applying."
      );
      lines.push("");

      // Summary table
      lines.push("| Metric | Value |");
      lines.push("| :--- | :--- |");
      lines.push(
        `| **Scope** | \`${result.scope.length > 0 ? result.scope.join(", ") : "Entire Project"}\` |`
      );
      lines.push(`| **Library Detected** | \`${result.project.i18nLibrary || "react-i18next"}\` |`);
      lines.push(`| **Structure Detected** | \`${result.project.structureType || "namespaces"}\` |`);
      lines.push(`| **Source Locale** | \`${result.project.sourceLocale || "en"}\` |`);
      lines.push(
        `| **Target Locales** | \`${(result.project.targetLocales || []).join(", ") || "none"}\` |`
      );
      lines.push(`| **User-facing Strings Detected** | **${result.scan.userFacing}** |`);
      lines.push(`| **Technical Strings Skipped** | ${result.scan.technical} |`);
      lines.push(`| **Planned Source Replacements** | ${result.plan.changes} |`);
      lines.push(`| **New Locale Entries** | ${result.plan.translationEntries} |`);
      if (result.plan.reviewItems > 0) {
        lines.push(`| **Items Needing Review** | ⚠️ ${result.plan.reviewItems} |`);
      }
      lines.push("");

      // Warnings / Review
      if (result.warnings.length > 0) {
        lines.push("#### ⚠️ Warnings & Review Items");
        for (const warning of result.warnings) {
          lines.push(`- ${warning}`);
        }
        lines.push("");
      }

      // Diff preview
      if (result.diff && result.diff.trim().length > 0) {
        lines.push("#### 📝 Proposed Changes Preview");
        lines.push("```diff");
        lines.push(result.diff.trim());
        lines.push("```");
        lines.push("");
      }

      // Confirmation / Next steps
      lines.push("---");
      lines.push("#### 🚀 Ready to Apply?");
      const scopeArgs = result.scope.length > 0 ? ` ${result.scope.join(" ")}` : "";
      lines.push(
        `To execute these changes, run:\n\`\`\`text\n/internationalize${scopeArgs} --apply\n\`\`\`\nor simply reply **"apply"**.`
      );
      return lines.join("\n");

    case "APPLIED":
    case "APPLIED_WITH_WARNINGS":
    case "PENDING_TRANSLATIONS":
      lines.push(
        result.status === "APPLIED"
          ? "### ✨ Internationalization Applied Successfully"
          : result.status === "PENDING_TRANSLATIONS"
          ? "### ⏳ Internationalization Applied (Translations Pending)"
          : "### ⚠️ Internationalization Applied with Warnings"
      );
      lines.push("");

      // Apply Summary table
      lines.push("| Metric | Result |");
      lines.push("| :--- | :--- |");
      lines.push(`| **Status** | \`${result.status}\` |`);
      lines.push(
        `| **Files Changed** | ${result.apply?.filesChanged.length ?? 0} |`
      );
      lines.push(
        `| **Source Replacements Applied** | ${result.apply?.sourceChangesApplied ?? 0} |`
      );
      lines.push(
        `| **Locale Entries Created** | ${result.apply?.translationEntriesCreated ?? 0} |`
      );

      if (result.translation) {
        lines.push(
          `| **Translations Generated** | ${result.translation.translated} (unchanged: ${result.translation.unchanged}, pending: ${result.translation.pending}) |`
        );
      }

      if (result.validation) {
        lines.push(
          `| **Validation Result** | ${result.validation.valid ? "✅ Passed (0 errors)" : `❌ ${result.validation.errorCount} error(s)`} |`
        );
      }
      lines.push("");

      // Modified files list
      if (result.apply && result.apply.filesChanged.length > 0) {
        lines.push("#### 📁 Modified Files");
        for (const file of result.apply.filesChanged) {
          lines.push(`- \`${file}\``);
        }
        lines.push("");
      }

      // Warnings
      if (result.warnings.length > 0) {
        lines.push("#### ⚠️ Warnings");
        for (const warning of result.warnings) {
          lines.push(`- ${warning}`);
        }
        lines.push("");
      }

      return lines.join("\n");

    case "REVIEW_REQUIRED":
      lines.push("### ⚠️ Developer Review Required");
      lines.push("");
      lines.push(
        "One or more hardcoded strings require manual developer review before replacements can be made safely."
      );
      lines.push("");
      if (result.warnings.length > 0) {
        lines.push("#### Review Items:");
        for (const warning of result.warnings) {
          lines.push(`- ${warning}`);
        }
      }
      return lines.join("\n");

    case "FAILED":
    case "FAILED_VALIDATION":
    default:
      lines.push("### ❌ Internationalization Failed");
      lines.push("");
      lines.push(`- **Status**: \`${result.status}\``);
      if (result.errors.length > 0) {
        lines.push("#### Errors:");
        for (const error of result.errors) {
          lines.push(`- ${error}`);
        }
      }
      if (result.validation && !result.validation.valid) {
        lines.push("#### Validation Issues:");
        for (const issue of result.validation.issues) {
          lines.push(
            `- [${issue.severity.toUpperCase()}] ${issue.namespace}:${issue.key ?? "*"} - ${issue.message}`
          );
        }
      }
      return lines.join("\n");
  }
}
