import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import { applyI18nPlan } from "../../src/core/replacement/plan-applicator.js";
import { readTextFile } from "../../src/utils/file-system.js";

describe("Nested Structure Coordination", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-nested-coord-"));

    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "nested-structure-test",
          version: "1.0.0",
          dependencies: {
            react: "18.3.1",
            "react-native": "0.76.0",
            i18next: "^23.16.8",
            "react-i18next": "^15.1.4",
          },
        },
        null,
        2
      )
    );

    await fs.writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react" } })
    );

    // Create single nested locale file: src/locales/en.json
    const localesDir = path.join(tempDir, "src", "locales");
    await fs.mkdir(localesDir, { recursive: true });
    await fs.writeFile(
      path.join(localesDir, "en.json"),
      JSON.stringify(
        {
          auth: {
            TITLE: "Sign In",
          },
          common: {
            CANCEL: "Cancel",
          },
        },
        null,
        2
      )
    );

    // Create feature screen
    const screenDir = path.join(tempDir, "src", "features", "auth");
    await fs.mkdir(screenDir, { recursive: true });
    await fs.writeFile(
      path.join(screenDir, "LoginScreen.tsx"),
      `import React from "react";
import { View, Text, Button } from "react-native";

export function LoginScreen() {
  return (
    <View>
      <Text>Welcome Back</Text>
      <Button title="Cancel" onPress={() => {}} />
    </View>
  );
}
`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects nested structure and generates dot-notation replacements with clean hook", async () => {
    const plan = await generateI18nPlan({ projectPath: tempDir });

    expect(plan.project.structureType).toBe("nested");

    const screenChanges = plan.sourceChanges.filter((sc) =>
      sc.file.includes("LoginScreen.tsx")
    );
    expect(screenChanges).toHaveLength(2);

    const welcomeChange = screenChanges.find((sc) => sc.source.includes("Welcome Back"));
    expect(welcomeChange).toBeDefined();
    expect(welcomeChange?.replacement).toBe('{t("auth.WELCOME_BACK")}');

    const cancelChange = screenChanges.find((sc) => sc.source.includes("Cancel"));
    expect(cancelChange).toBeDefined();
    // Reused key should also use dot notation
    expect(cancelChange?.replacement).toBe('{t("common.CANCEL")}');
    expect(cancelChange?.action).toBe("REPLACE");

    const cancelTrans = plan.translations.find((t) => t.key === "CANCEL");
    expect(cancelTrans?.action).toBe("REUSE");

    // Hook must NOT have any namespace arguments
    const requiredChanges = welcomeChange?.requiredCodeChanges || [];
    const hookChange = requiredChanges.find((c) => c.type === "ADD_HOOK");
    expect(hookChange).toBeDefined();
    expect(hookChange?.value).toBe("const { t } = useTranslation()");

    const importChange = requiredChanges.find((c) => c.type === "ADD_IMPORT");
    expect(importChange).toBeDefined();
    expect(importChange?.value).toBe("useTranslation");
  });

  it("applies nested plan modifying single locales/en.json and injecting code cleanly", async () => {
    const plan = await generateI18nPlan({ projectPath: tempDir });
    const applyResult = await applyI18nPlan({ plan, projectPath: tempDir, dryRun: false });

    expect(applyResult.success).toBe(true);
    expect(applyResult.sourceChangesApplied).toBe(2);

    // Verify en.json was updated with nested structure
    const updatedLocale = JSON.parse(
      (await readTextFile(path.join(tempDir, "src", "locales", "en.json"))) || "{}"
    );
    expect(updatedLocale.auth.WELCOME_BACK).toBe("Welcome Back");
    expect(updatedLocale.auth.TITLE).toBe("Sign In");
    expect(updatedLocale.common.CANCEL).toBe("Cancel");

    // Verify source code was transformed
    const transformedCode = await readTextFile(
      path.join(tempDir, "src", "features", "auth", "LoginScreen.tsx")
    );
    expect(transformedCode).toContain('import { useTranslation } from "react-i18next";');
    expect(transformedCode).toContain("const { t } = useTranslation();");
    expect(transformedCode).toContain('{t("auth.WELCOME_BACK")}');
    expect(transformedCode).toContain('{t("common.CANCEL")}');
    // Ensure no colon syntax was generated
    expect(transformedCode).not.toContain("auth:");
    expect(transformedCode).not.toContain("common:");
  });
});
