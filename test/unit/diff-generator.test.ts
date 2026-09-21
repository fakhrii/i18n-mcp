import { describe, it, expect } from "vitest";
import { generateUnifiedDiff } from "../../src/core/replacement/diff-generator.js";

describe("Unified Diff Generator", () => {
  it("returns empty string when contents are identical", () => {
    const diff = generateUnifiedDiff("src/App.tsx", "const a = 1;\n", "const a = 1;\n");
    expect(diff).toBe("");
  });

  it("generates unified diff with added and deleted lines", () => {
    const original = 'function App() {\n  return <Text>Hello</Text>;\n}\n';
    const modified = 'function App() {\n  return <Text>{t("HELLO")}</Text>;\n}\n';

    const diff = generateUnifiedDiff("src/App.tsx", original, modified);

    expect(diff).toContain("--- a/src/App.tsx");
    expect(diff).toContain("+++ b/src/App.tsx");
    expect(diff).toContain("-   return <Text>Hello</Text>;");
    expect(diff).toContain('+   return <Text>{t("HELLO")}</Text>;');
  });

  it("includes contextual unchanged lines around edits", () => {
    const original = "line1\nline2\nline3\nline4\nline5\n";
    const modified = "line1\nline2\nline3_modified\nline4\nline5\n";

    const diff = generateUnifiedDiff("file.txt", original, modified);
    expect(diff).toContain("- line3");
    expect(diff).toContain("+ line3_modified");
    expect(diff).toContain("  line2");
    expect(diff).toContain("  line4");
  });
});
