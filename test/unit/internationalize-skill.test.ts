import { describe, it, expect } from "vitest";
import { parseInternationalizeCommand } from "../../src/skills/internationalize-parser.js";
import { formatInternationalizeResult } from "../../src/skills/internationalize-formatter.js";
import type { InternationalizeResult } from "../../src/models/internationalize.js";

describe("/internationalize Skill & Command Parser", () => {
  describe("Root and Scoped Slash Commands", () => {
    it("parses bare /internationalize with conservative safety defaults", () => {
      const parsed = parseInternationalizeCommand("/internationalize");
      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);
      expect(parsed.translate).toBe(false);
      expect(parsed.scope).toBeUndefined();
    });

    it("parses single directory scope", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/features/auth"
      );
      expect(parsed.scope).toEqual(["src/features/auth"]);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);
    });

    it("parses single file scope", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/features/auth/LoginScreen.tsx"
      );
      expect(parsed.scope).toEqual(["src/features/auth/LoginScreen.tsx"]);
      expect(parsed.dryRun).toBe(true);
    });

    it("parses multiple paths in scope", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/features/auth src/features/profile"
      );
      expect(parsed.scope).toEqual([
        "src/features/auth",
        "src/features/profile",
      ]);
    });
  });

  describe("Flag Parsing and Safety Guarantees", () => {
    it("sets apply=true and dryRun=false when --apply is specified", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/features/auth --apply"
      );
      expect(parsed.apply).toBe(true);
      expect(parsed.dryRun).toBe(false);
      expect(parsed.scope).toEqual(["src/features/auth"]);
    });

    it("ensures explicit --dry-run overrides --apply for strict safety", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/features/auth --apply --dry-run"
      );
      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);
    });

    it("extracts target locales from --target-locales=fr,ar flag", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize --target-locales=fr,ar"
      );
      expect(parsed.targetLocales).toEqual(["fr", "ar"]);
      expect(parsed.translate).toBe(true);
    });

    it("extracts target locales with space separator --target-locales fr,es", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize src/screens --target-locales fr,es --apply"
      );
      expect(parsed.scope).toEqual(["src/screens"]);
      expect(parsed.targetLocales).toEqual(["fr", "es"]);
      expect(parsed.translate).toBe(true);
      expect(parsed.apply).toBe(true);
    });

    it("extracts source locale and namespaces", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize --source-locale=en --namespaces=auth,common"
      );
      expect(parsed.sourceLocale).toBe("en");
      expect(parsed.namespaces).toEqual(["auth", "common"]);
    });

    it("extracts backup and fail-on-warnings flags", () => {
      const parsed = parseInternationalizeCommand(
        "/internationalize --create-backup --fail-on-warnings"
      );
      expect(parsed.createBackup).toBe(true);
      expect(parsed.failOnWarnings).toBe(true);
    });
  });

  describe("Natural Language Intent Parsing", () => {
    it("infers scope for 'Internationalize this screen' from activeContextFile", () => {
      const parsed = parseInternationalizeCommand("Internationalize this screen", {
        activeContextFile: "src/screens/SettingsScreen.tsx",
      });
      expect(parsed.scope).toEqual(["src/screens/SettingsScreen.tsx"]);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);
    });

    it("infers scope for 'Internationalize this feature' from activeContextFile", () => {
      const parsed = parseInternationalizeCommand("Internationalize this feature", {
        activeContextFile: "src/features/checkout/components/CartItem.tsx",
      });
      expect(parsed.scope).toEqual(["src/features/checkout"]);
    });

    it("infers folder scope for 'Find and replace all hardcoded user-facing strings in this folder'", () => {
      const parsed = parseInternationalizeCommand(
        "Find and replace all hardcoded user-facing strings in this folder",
        {
          activeContextFile: "src/components/modals/ConfirmModal.tsx",
        }
      );
      expect(parsed.scope).toEqual(["src/components/modals"]);
    });

    it("infers scope for 'Internationalize the auth module'", () => {
      const parsed = parseInternationalizeCommand("Internationalize the auth module");
      expect(parsed.scope).toEqual(["src/features/auth"]);
    });

    it("extracts natural language target language 'translate to French and Arabic'", () => {
      const parsed = parseInternationalizeCommand(
        "Internationalize checkout and translate to French and Arabic"
      );
      expect(parsed.scope).toEqual(["src/features/checkout"]);
      expect(parsed.translate).toBe(true);
      expect(parsed.targetLocales).toEqual(["fr", "ar"]);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);
    });

    it("extracts Spanish language code from natural language", () => {
      const parsed = parseInternationalizeCommand(
        "Internationalize the profile module and translate into Spanish"
      );
      expect(parsed.scope).toEqual(["src/features/profile"]);
      expect(parsed.translate).toBe(true);
      expect(parsed.targetLocales).toEqual(["es"]);
    });

    it("parses user confirmation prompt as apply=true", () => {
      const parsed1 = parseInternationalizeCommand("apply");
      expect(parsed1.apply).toBe(true);
      expect(parsed1.dryRun).toBe(false);

      const parsed2 = parseInternationalizeCommand("yes, apply changes");
      expect(parsed2.apply).toBe(true);
      expect(parsed2.dryRun).toBe(false);

      const parsed3 = parseInternationalizeCommand("proceed with apply");
      expect(parsed3.apply).toBe(true);
      expect(parsed3.dryRun).toBe(false);
    });
  });
});

describe("/internationalize Output Formatter", () => {
  it("formats NO_CHANGES response cleanly", () => {
    const mockResult: InternationalizeResult = {
      success: true,
      status: "NO_CHANGES",
      project: { i18nLibrary: "react-i18next", sourceLocale: "en" },
      scope: ["src/features/auth"],
      scan: { candidates: 0, userFacing: 0, technical: 0, review: 0 },
      plan: { changes: 0, reviewItems: 0, translationEntries: 0 },
      warnings: [],
      errors: [],
    };

    const formatted = formatInternationalizeResult(mockResult);
    expect(formatted).toContain("Codebase Already Internationalized");
    expect(formatted).toContain("NO_CHANGES");
    expect(formatted).toContain("src/features/auth");
  });

  it("formats PLAN_READY preview with summary and diff", () => {
    const mockResult: InternationalizeResult = {
      success: true,
      status: "PLAN_READY",
      project: {
        i18nLibrary: "react-i18next",
        sourceLocale: "en",
        targetLocales: ["fr"],
      },
      scope: ["src/features/auth"],
      scan: { candidates: 5, userFacing: 3, technical: 2, review: 0 },
      plan: { changes: 3, reviewItems: 0, translationEntries: 3 },
      warnings: [],
      errors: [],
      diff: "+ const { t } = useTranslation();\n- <Text>Login</Text>\n+ <Text>{t('auth:login')}</Text>",
    };

    const formatted = formatInternationalizeResult(mockResult);
    expect(formatted).toContain("Internationalization Plan Ready (Preview Mode)");
    expect(formatted).toContain("Dry-run");
    expect(formatted).toContain("Proposed Changes Preview");
    expect(formatted).toContain("/internationalize src/features/auth --apply");
  });

  it("formats APPLIED response with file modifications and validation report", () => {
    const mockResult: InternationalizeResult = {
      success: true,
      status: "APPLIED",
      project: { i18nLibrary: "react-i18next", sourceLocale: "en" },
      scope: ["src/features/auth"],
      scan: { candidates: 3, userFacing: 3, technical: 0, review: 0 },
      plan: { changes: 3, reviewItems: 0, translationEntries: 3 },
      apply: {
        filesChanged: [
          "src/features/auth/LoginScreen.tsx",
          "locales/en/auth.json",
        ],
        sourceChangesApplied: 3,
        translationEntriesCreated: 3,
      },
      translation: {
        translated: 3,
        unchanged: 0,
        pending: 0,
        review: 0,
      },
      validation: {
        valid: true,
        errorCount: 0,
        warningCount: 0,
        issues: [],
        summary: {
          totalKeys: 3,
          localesChecked: ["en", "fr"],
          namespacesChecked: ["auth"],
        },
      },
      warnings: [],
      errors: [],
    };

    const formatted = formatInternationalizeResult(mockResult);
    expect(formatted).toContain("Internationalization Applied Successfully");
    expect(formatted).toContain("src/features/auth/LoginScreen.tsx");
    expect(formatted).toContain("Passed (0 errors)");
  });

  it("formats REVIEW_REQUIRED response with warnings", () => {
    const mockResult: InternationalizeResult = {
      success: true,
      status: "REVIEW_REQUIRED",
      project: { i18nLibrary: "react-i18next" },
      scope: [],
      scan: { candidates: 2, userFacing: 1, technical: 0, review: 1 },
      plan: { changes: 1, reviewItems: 1, translationEntries: 1 },
      warnings: [
        "String in template literal requires manual review before replacement.",
      ],
      errors: [],
    };

    const formatted = formatInternationalizeResult(mockResult);
    expect(formatted).toContain("Developer Review Required");
    expect(formatted).toContain("String in template literal requires manual review");
  });

  describe("End-to-End Skill Flow (Parser -> Orchestrator -> Formatter)", () => {
    it("executes preview flow on fixture without modifying files", async () => {
      const { internationalizeProject } = await import(
        "../../src/core/orchestration/internationalize-service.js"
      );
      const path = await import("path");

      const fixturePath = path.resolve("test/fixtures/react-native-app");

      // 1. User runs "/internationalize src/features/auth"
      const parsed = parseInternationalizeCommand("/internationalize src/features/auth", {
        projectPath: fixturePath,
      });

      expect(parsed.dryRun).toBe(true);
      expect(parsed.apply).toBe(false);

      // 2. Invoke orchestrator
      const result = await internationalizeProject(parsed);
      expect(result.status).toBe("PLAN_READY");
      expect(result.plan.changes).toBeGreaterThan(0);

      // 3. Format response for developer
      const formatted = formatInternationalizeResult(result);
      expect(formatted).toContain("Internationalization Plan Ready (Preview Mode)");
      expect(formatted).toContain("Dry-run");
      expect(formatted).toContain("Ready to Apply?");
      expect(formatted).toContain("reply **\"apply\"**");

      // 4. Developer replies "apply"
      const applyParsed = parseInternationalizeCommand("apply", {
        projectPath: fixturePath,
      });
      expect(applyParsed.apply).toBe(true);
      expect(applyParsed.dryRun).toBe(false);
    });
  });
});

