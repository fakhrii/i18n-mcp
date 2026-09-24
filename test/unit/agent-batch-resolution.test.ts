import { describe, it, expect } from "vitest";
import { classifyString } from "../../src/core/classifier/classifier.js";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import * as path from "node:path";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("Proposition 5: Two-Stage Hybrid (Deterministic AST + Agent Batch Resolution)", () => {
  describe("Stage 1: Ambiguity Isolation for Title-Cased Single Words", () => {
    it("flags Title-cased single word on custom unknown prop as AMBIGUOUS", () => {
      const result = classifyString({
        text: "Save",
        astType: "JSX_ATTRIBUTE",
        propName: "action",
        componentName: "CustomBar",
      });

      expect(result.semanticRole).toBe("AMBIGUOUS");
      expect(result.isUserFacing).toBe(true);
      expect(result.confidence).toBeLessThan(0.85);
    });

    it("flags Title-cased single word in unconfirmed expression as AMBIGUOUS", () => {
      const result = classifyString({
        text: "Cancel",
        astType: "STRING_LITERAL",
      });

      expect(result.semanticRole).toBe("AMBIGUOUS");
      expect(result.isUserFacing).toBe(true);
    });

    it("keeps lowercase single word on unknown prop as CONFIRMED_TECHNICAL", () => {
      const result = classifyString({
        text: "outline",
        astType: "JSX_ATTRIBUTE",
        propName: "variant",
        componentName: "CustomBar",
      });

      expect(result.semanticRole).toBe("CONFIRMED_TECHNICAL");
      expect(result.isUserFacing).toBe(false);
    });
  });

  describe("Stage 2: Agent Batch Decisions Integration in generateI18nPlan", () => {
    it("honors candidateDecisions=true to force approval of a candidate", async () => {
      const plan = await generateI18nPlan({
        projectPath: FIXTURE_PATH,
        candidateDecisions: {
          "Welcome back": true,
        },
      });

      // Find the source change for "Welcome back"
      const sc = plan.sourceChanges.find((s) => s.source.includes("Welcome back"));
      expect(sc).toBeDefined();
      expect(sc?.action).toBe("REPLACE");
    });

    it("honors candidateDecisions=false to skip a candidate and avoid creating translation entry", async () => {
      // In the fixture app, there are strings including "Enter your password"
      // If the Agent decides "Enter your password" is false (skip):
      const plan = await generateI18nPlan({
        projectPath: FIXTURE_PATH,
        candidateDecisions: {
          "Enter your password": false,
        },
      });

      // The source change for "Enter your password" should be planned as SKIP
      const passSc = plan.sourceChanges.find((s) => s.source.includes("Enter your password"));
      expect(passSc).toBeDefined();
      expect(passSc?.action).toBe("SKIP");

      // No translation plan should be generated for "Enter your password"
      const passTrans = plan.translations.find((t) => t.sourceText === "Enter your password");
      expect(passTrans).toBeUndefined();
    });
  });
});
