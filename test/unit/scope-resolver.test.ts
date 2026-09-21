import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { resolveProjectFiles } from "../../src/core/scope/scope-resolver.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("Scope Resolver", () => {
  it("resolves all source files in fixture project when no scope is provided", async () => {
    const files = await resolveProjectFiles(FIXTURE_PATH);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("src/features/auth/LoginScreen.tsx");
    expect(files).toContain("src/features/profile/ProfileScreen.tsx");
    expect(files).toContain("src/components/CustomButton.tsx");
  });

  it("resolves only files in a specified folder scope", async () => {
    const files = await resolveProjectFiles(FIXTURE_PATH, {
      scope: "src/features/auth",
    });

    expect(files).toEqual(["src/features/auth/LoginScreen.tsx"]);
  });

  it("resolves a single specific file when passed as scope", async () => {
    const files = await resolveProjectFiles(FIXTURE_PATH, {
      scope: "src/features/profile/ProfileScreen.tsx",
    });

    expect(files).toEqual(["src/features/profile/ProfileScreen.tsx"]);
  });

  it("respects exclude patterns", async () => {
    const files = await resolveProjectFiles(FIXTURE_PATH, {
      exclude: ["**/features/auth/**"],
    });

    expect(files).not.toContain("src/features/auth/LoginScreen.tsx");
    expect(files).toContain("src/features/profile/ProfileScreen.tsx");
  });
});
