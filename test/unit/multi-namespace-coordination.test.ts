import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import { applyI18nPlan } from "../../src/core/replacement/plan-applicator.js";
import { readTextFile } from "../../src/utils/file-system.js";

describe("Multi-Namespace Coordination", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-multi-ns-"));

    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "multi-ns-test",
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

    // Create locales directory with common and profile
    const localesDir = path.join(tempDir, "src", "locales", "en");
    await fs.mkdir(localesDir, { recursive: true });
    await fs.writeFile(
      path.join(localesDir, "common.json"),
      JSON.stringify({ CANCEL: "Cancel" }, null, 2)
    );
    await fs.writeFile(
      path.join(localesDir, "profile.json"),
      JSON.stringify({ TITLE: "Profile" }, null, 2)
    );

    // Create screens
    const screensDir = path.join(tempDir, "src", "features", "profile");
    await fs.mkdir(screensDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("coordinates multi-namespace hook and key prefixes for greenfield component", async () => {
    // Component with no existing hook, containing feature-specific text AND common text
    const filePath = path.join(
      tempDir,
      "src",
      "features",
      "profile",
      "EditProfileScreen.tsx"
    );
    await fs.writeFile(
      filePath,
      `import React from "react";
import { View, Text, Button } from "react-native";

export function EditProfileScreen() {
  return (
    <View>
      <Text>Edit User Profile</Text>
      <Button title="Save" onPress={() => {}} />
    </View>
  );
}
`,
      "utf8"
    );

    const plan = await generateI18nPlan({ projectPath: tempDir });

    const editProfileChanges = plan.sourceChanges.filter((sc) =>
      sc.file.includes("EditProfileScreen.tsx")
    );
    expect(editProfileChanges.length).toBe(2);

    // Primary feature string should use bare key
    const profileChange = editProfileChanges.find((sc) => sc.namespace === "profile");
    expect(profileChange).toBeDefined();
    expect(profileChange?.replacement).toBe('{t("EDIT_USER_PROFILE")}');

    // Common string should be prefixed with "common:"
    const commonChange = editProfileChanges.find((sc) => sc.namespace === "common");
    expect(commonChange).toBeDefined();
    expect(commonChange?.replacement).toBe('{t("common:SAVE")}');

    // Hook should be planned with both namespaces, primary first
    const hookChange = editProfileChanges[0]?.requiredCodeChanges?.find(
      (c) => c.type === "ADD_HOOK"
    );
    expect(hookChange).toBeDefined();
    expect(hookChange?.value).toBe('const { t } = useTranslation(["profile", "common"])');

    // Apply plan and verify code outcome
    const applyResult = await applyI18nPlan({
      projectPath: tempDir,
      plan,
      dryRun: false,
    });
    expect(applyResult.success).toBe(true);

    const updatedCode = await readTextFile(filePath);
    expect(updatedCode).toContain('useTranslation(["profile", "common"])');
    expect(updatedCode).toContain('{t("EDIT_USER_PROFILE")}');
    expect(updatedCode).toContain('{t("common:SAVE")}');
  });

  it("upgrades existing single namespace hook to multi-namespace hook when common key is needed", async () => {
    // Component with existing useTranslation("profile") that needs a common string "Save"
    const filePath = path.join(
      tempDir,
      "src",
      "features",
      "profile",
      "SettingsScreen.tsx"
    );
    await fs.writeFile(
      filePath,
      `import React from "react";
import { View, Button } from "react-native";
import { useTranslation } from "react-i18next";

export function SettingsScreen() {
  const { t } = useTranslation("profile");

  return (
    <View>
      <Button title="Save" onPress={() => {}} />
    </View>
  );
}
`,
      "utf8"
    );

    const plan = await generateI18nPlan({ projectPath: tempDir });

    const settingsChanges = plan.sourceChanges.filter((sc) =>
      sc.file.includes("SettingsScreen.tsx")
    );
    expect(settingsChanges.length).toBe(1);

    const saveChange = settingsChanges[0]!;
    expect(saveChange.namespace).toBe("common");
    expect(saveChange.replacement).toBe('{t("common:SAVE")}');

    const updateHookChange = saveChange.requiredCodeChanges?.find(
      (c) => c.type === "UPDATE_HOOK"
    );
    expect(updateHookChange).toBeDefined();
    expect(updateHookChange?.value).toBe(
      'const { t } = useTranslation(["profile", "common"])'
    );

    // Apply plan and verify code outcome
    const applyResult = await applyI18nPlan({
      projectPath: tempDir,
      plan,
      dryRun: false,
    });
    expect(applyResult.success).toBe(true);

    const updatedCode = await readTextFile(filePath);
    expect(updatedCode).toContain('useTranslation(["profile", "common"])');
    expect(updatedCode).not.toContain('useTranslation("profile");');
    expect(updatedCode).toContain('{t("common:SAVE")}');
  });
});
