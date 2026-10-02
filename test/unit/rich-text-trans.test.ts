import { describe, it, expect } from "vitest";
import { scanSourceFileAst } from "../../src/core/scanner/ast-scanner.js";
import {
  buildReplacementExpression,
  analyzeFileTranslationContext,
  determineRequiredCodeChanges,
} from "../../src/core/planning/source-change-planner.js";
import { injectRequiredImports } from "../../src/core/replacement/ast-transformer.js";

describe("Phase P2: Rich Text & <Trans> Component Support", () => {
  it("detects compound JSX elements with inline links and styled text as a single rich text entry", () => {
    const code = `
      export const TermsNotice = () => {
        return (
          <Text style={styles.notice}>
            Please accept our <Text style={styles.link} onPress={openTerms}>Terms of Service</Text> and <Text style={styles.link} onPress={openPrivacy}>Privacy Policy</Text>.
          </Text>
        );
      };
    `;

    const results = scanSourceFileAst({ filePath: "TermsNotice.tsx", sourceCode: code });
    // Must be exactly 1 candidate, NOT 4 fragmented pieces!
    expect(results).toHaveLength(1);
    const item = results[0]!;

    expect(item.isRichText).toBe(true);
    expect(item.text).toBe(
      "Please accept our <termsLink>Terms of Service</termsLink> and <privacyLink>Privacy Policy</privacyLink>."
    );
    expect(item.richTextComponents).toBeDefined();
    expect(item.richTextComponents!["termsLink"]).toBe(
      "<Text style={styles.link} onPress={openTerms} />"
    );
    expect(item.richTextComponents!["privacyLink"]).toBe(
      "<Text style={styles.link} onPress={openPrivacy} />"
    );
  });

  it("detects web HTML inline tags (a, strong, em) inside paragraph elements", () => {
    const code = `
      export const WebPrompt = () => {
        return (
          <p className="description">
            Click <a href="/login">here</a> to sign in with your <strong>organization</strong> account.
          </p>
        );
      };
    `;

    const results = scanSourceFileAst({ filePath: "WebPrompt.tsx", sourceCode: code });
    expect(results).toHaveLength(1);
    const item = results[0]!;

    expect(item.isRichText).toBe(true);
    expect(item.text).toBe(
      "Click <link>here</link> to sign in with your <bold>organization</bold> account."
    );
    expect(item.richTextComponents!["link"]).toBe('<a href="/login" />');
    expect(item.richTextComponents!["bold"]).toBe("<strong />");
  });

  it("builds <Trans> replacement expression with components prop", () => {
    const code = `
      <Text>
        By continuing you agree to the <Text style={styles.link}>User Agreement</Text>.
      </Text>
    `;

    const [item] = scanSourceFileAst({ filePath: "Test.tsx", sourceCode: code });
    const fileCtx = analyzeFileTranslationContext('import { useTranslation } from "react-i18next";');

    const replacement = buildReplacementExpression(item!, "common", "TERMS_NOTICE", fileCtx);
    expect(replacement).toContain("<Trans i18nKey=\"TERMS_NOTICE\"");
    expect(replacement).toContain("components={{ userLink: <Text style={styles.link} /> }}");
    expect(replacement).toContain("By continuing you agree to the <userLink>User Agreement</userLink>.");
  });

  it("injects Trans import into react-i18next import statement", () => {
    const sourceCode = `import { useTranslation } from "react-i18next";\n\nexport const Comp = () => null;`;
    const fileCtx = analyzeFileTranslationContext(sourceCode);
    expect(fileCtx.hasTransImport).toBe(false);

    const codeChanges = determineRequiredCodeChanges(fileCtx, "common", true);
    expect(codeChanges).toContainEqual({
      type: "ADD_IMPORT",
      value: "Trans",
      module: "react-i18next",
    });

    const transformed = injectRequiredImports(sourceCode, codeChanges);
    expect(transformed).toContain('import { useTranslation, Trans } from "react-i18next";');
  });

  it("does not treat simple single-text JSX elements as rich text", () => {
    const code = `<Text>Welcome back to your dashboard</Text>`;
    const results = scanSourceFileAst({ filePath: "Simple.tsx", sourceCode: code });
    expect(results).toHaveLength(1);
    expect(results[0]!.isRichText).toBeUndefined();
    expect(results[0]!.text).toBe("Welcome back to your dashboard");
  });
});
