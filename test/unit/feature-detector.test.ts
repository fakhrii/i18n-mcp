import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { detectProjectStructure } from "../../src/core/discovery/feature-detector.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("Feature Detector", () => {
  it("detects feature directory and feature modules", async () => {
    const structure = await detectProjectStructure(FIXTURE_PATH);

    expect(structure.featureDirectory).toBe("src/features");
    expect(structure.features).toContain("auth");
    expect(structure.features).toContain("profile");
  });
});
