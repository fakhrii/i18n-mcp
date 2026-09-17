import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { detectProjectMetadata } from "../../src/core/discovery/project-detector.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("Project Detector", () => {
  it("detects React Native framework from dependencies", async () => {
    const metadata = await detectProjectMetadata(FIXTURE_PATH);
    expect(metadata.framework).toBe("react-native");
    expect(metadata.packageName).toBe("sample-rn-app");
  });

  it("detects TypeScript language from tsconfig and dependencies", async () => {
    const metadata = await detectProjectMetadata(FIXTURE_PATH);
    expect(metadata.language).toBe("typescript");
  });

  it("detects yarn package manager from yarn.lock", async () => {
    const metadata = await detectProjectMetadata(FIXTURE_PATH);
    expect(metadata.packageManager).toBe("yarn");
  });
});
