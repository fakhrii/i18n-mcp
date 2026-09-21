import { describe, it, expect } from "vitest";
import { scanSourceFileAst } from "../../src/core/scanner/ast-scanner.js";
import { classifyString } from "../../src/core/classifier/classifier.js";
import { buildReplacementExpression } from "../../src/core/planning/source-change-planner.js";

describe("Template Literal & Time Formatter Handling", () => {
  describe("Classification of time/unit formatting strings", () => {
    it("classifies '${minutes}m : ${String(seconds).padStart(2, '0')}s' as TECHNICAL (isUserFacing: false)", () => {
      const code = `
        function formatDuration(minutes: number, seconds: number) {
          return \`\${minutes}m : \${String(seconds).padStart(2, '0')}s\`;
        }
      `;

      const results = scanSourceFileAst({ filePath: "test.ts", sourceCode: code });
      // Because onlyUserFacing is default true, this technical duration string MUST NOT be reported as user-facing!
      expect(results).toHaveLength(0);

      // When scanning all strings (including technical):
      const allResults = scanSourceFileAst({
        filePath: "test.ts",
        sourceCode: code,
        onlyUserFacing: false,
      });
      expect(allResults).toHaveLength(1);
      expect(allResults[0]!.classification).toBe("TECHNICAL");
      expect(allResults[0]!.reason).toContain("variables and punctuation");
    });

    it("classifies various timer and unit template strings as TECHNICAL", () => {
      const testCases = [
        "{{minutes}}m : {{seconds}}s",
        "${minutes}m : ${seconds}s",
        "${hours}h ${minutes}m ${seconds}s",
        "${mins}min ${secs}sec",
        "${count}px",
        "${val}dp",
        "${width}x${height}",
        "${current}/${total}",
        "${min}-${max}",
        "${speed} kb/s",
        "${percent}%",
      ];

      for (const text of testCases) {
        const res = classifyString({ text, astType: "TEMPLATE_LITERAL" });
        expect(res.isUserFacing, `Expected '${text}' to not be user facing`).toBe(false);
        expect(res.classification).toBe("TECHNICAL");
      }
    });
  });

  describe("Variable extraction and expression replacement for user-facing template literals", () => {
    it("extracts clean variable names for complex expressions instead of mangled strings", () => {
      const code = `
        export const Notification = () => {
          return <Text>{\`Your session expires in \${String(seconds).padStart(2, '0')} seconds\`}</Text>;
        };
      `;

      const results = scanSourceFileAst({ filePath: "Notification.tsx", sourceCode: code });
      expect(results).toHaveLength(1);
      const item = results[0]!;

      // 1. Clean variable name, NOT 'StringsecondspadStart20'
      expect(item.variables).toEqual(["seconds"]);
      expect(item.text).toBe("Your session expires in {{seconds}} seconds");

      // 2. Variable expressions map
      expect(item.variableExpressions).toEqual({
        seconds: "String(seconds).padStart(2, '0')",
      });

      // 3. Replacement expression uses valid JS property-value syntax
      const fileCtx = {
        filePath: "Notification.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["common"],
        accessPattern: "useTranslation" as const,
      };

      const replacement = buildReplacementExpression(
        item,
        "common",
        "SESSION_EXPIRES",
        fileCtx
      );

      expect(replacement).toBe(
        `t("SESSION_EXPIRES", { seconds: String(seconds).padStart(2, '0') })`
      );
      expect(replacement).not.toContain("StringsecondspadStart20");
    });

    it("uses shorthand syntax for simple identifiers and full syntax for property accesses", () => {
      const code = `
        export const Welcome = () => {
          return <Text>{\`Welcome \${user.firstName}, you have \${unreadCount} messages\`}</Text>;
        };
      `;

      const results = scanSourceFileAst({ filePath: "Welcome.tsx", sourceCode: code });
      expect(results).toHaveLength(1);
      const item = results[0]!;

      expect(item.variables).toEqual(["firstName", "unreadCount"]);
      expect(item.text).toBe("Welcome {{firstName}}, you have {{unreadCount}} messages");

      const fileCtx = {
        filePath: "Welcome.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["common"],
        accessPattern: "useTranslation" as const,
      };

      const replacement = buildReplacementExpression(
        item,
        "common",
        "WELCOME_USER",
        fileCtx
      );

      // Shorthand for simple identifier unreadCount, key-value for user.firstName
      expect(replacement).toBe(
        `t("WELCOME_USER", { firstName: user.firstName, unreadCount })`
      );
    });
  });
});
