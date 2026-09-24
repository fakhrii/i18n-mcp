import { describe, it, expect } from "vitest";
import {
  classifyString,
  computeSemanticRole,
} from "../../src/core/classifier/classifier.js";
import { scanSourceFileAst } from "../../src/core/scanner/ast-scanner.js";

describe("Semantic Role & Agent Disambiguation", () => {
  it("computes CONFIRMED_UI for high confidence user facing strings", () => {
    expect(computeSemanticRole(true, 0.95)).toBe("CONFIRMED_UI");
    expect(computeSemanticRole(true, 0.85)).toBe("CONFIRMED_UI");
  });

  it("computes CONFIRMED_TECHNICAL for high confidence technical strings", () => {
    expect(computeSemanticRole(false, 0.99)).toBe("CONFIRMED_TECHNICAL");
    expect(computeSemanticRole(false, 0.85)).toBe("CONFIRMED_TECHNICAL");
  });

  it("computes AMBIGUOUS for medium or low confidence strings", () => {
    expect(computeSemanticRole(true, 0.65)).toBe("AMBIGUOUS");
    expect(computeSemanticRole(true, 0.78)).toBe("AMBIGUOUS");
    expect(computeSemanticRole(false, 0.50)).toBe("AMBIGUOUS");
  });

  it("attaches semanticRole to detected strings in AST scanner", () => {
    const code = `
      import React from 'react';
      import { View, Text, Button } from 'react-native';

      export const Profile = () => (
        <View>
          <Text>Welcome back</Text>
          <Button title="Continue" />
        </View>
      );
    `;

    const results = scanSourceFileAst({
      filePath: "Profile.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    expect(results.length).toBe(2);
    expect(results[0].text).toBe("Welcome back");
    expect(results[0].semanticRole).toBe("CONFIRMED_UI");
    expect(results[1].text).toBe("Continue");
    expect(results[1].semanticRole).toBe("CONFIRMED_UI");
  });

  it("supports ambiguousOnly filter to extract candidates needing Agent/human evaluation", () => {
    const code = `
      import React from 'react';
      import { View, Text } from 'react-native';

      export const Screen = () => {
        const title = "Welcome back to the application";
        return (
          <View>
            <Text>Save</Text>
          </View>
        );
      };
    `;

    const allResults = scanSourceFileAst({
      filePath: "Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    const ambiguousResults = scanSourceFileAst({
      filePath: "Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
      ambiguousOnly: true,
    });

    // ambiguousResults should only contain items with semanticRole === 'AMBIGUOUS'
    for (const item of ambiguousResults) {
      expect(item.semanticRole).toBe("AMBIGUOUS");
    }
    expect(ambiguousResults.length).toBeLessThanOrEqual(allResults.length);
  });
});
