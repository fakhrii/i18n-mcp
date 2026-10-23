import { describe, it, expect } from "vitest";
import { scanHtmlTemplateFile } from "../../src/core/scanner/html-scanner.js";

describe("Angular HTML Template Scanner", () => {
  it("detects user-facing text nodes in HTML tags", () => {
    const html = `
<div class="container">
  <h1>Welcome to the Platform</h1>
  <p>Manage your account settings below.</p>
  <button type="submit">Submit Form</button>
</div>
`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/login/login.component.html",
      sourceCode: html,
    });

    expect(results).toHaveLength(3);
    expect(results[0]?.text).toBe("Welcome to the Platform");
    expect(results[0]?.componentName).toBe("h1");
    expect(results[0]?.type).toBe("JSX_TEXT");

    expect(results[1]?.text).toBe("Manage your account settings below.");
    expect(results[1]?.componentName).toBe("p");

    expect(results[2]?.text).toBe("Submit Form");
    expect(results[2]?.componentName).toBe("button");
  });

  it("detects user-facing attributes on HTML elements", () => {
    const html = `
<form>
  <input type="text" placeholder="Enter your username" />
  <button type="button" title="Close modal">X</button>
  <img src="avatar.png" alt="User avatar image" />
</form>
`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/form/form.component.html",
      sourceCode: html,
    });

    const placeholders = results.filter((r) => r.propName === "placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.text).toBe("Enter your username");
    expect(placeholders[0]?.rawText).toBe('"Enter your username"');

    const titles = results.filter((r) => r.propName === "title");
    expect(titles).toHaveLength(1);
    expect(titles[0]?.text).toBe("Close modal");

    const alts = results.filter((r) => r.propName === "alt");
    expect(alts).toHaveLength(1);
    expect(alts[0]?.text).toBe("User avatar image");
  });

  it("skips elements and bindings that are already translated", () => {
    const html = `
<div>
  <h1>{{ 'WELCOME.TITLE' | translate }}</h1>
  <p [translate]="'ACCOUNT.SETTINGS'"></p>
  <span translate>BUTTON.SAVE</span>
  <input type="text" [placeholder]="'SEARCH_PLACEHOLDER' | translate" />
  <h2>Hardcoded Title</h2>
</div>
`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/home/home.component.html",
      sourceCode: html,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Hardcoded Title");
  });

  it("skips HTML comments and script/style tags", () => {
    const html = `
<div>
  <!-- <h1>Commented Out Title</h1> -->
  <style>
    .test { color: red; }
  </style>
  <script>
    console.log("Not UI text");
  </script>
  <p>Visible Paragraph</p>
</div>
`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/test/test.component.html",
      sourceCode: html,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Visible Paragraph");
  });

  it("handles template interpolations and extracts variables", () => {
    const html = `
<div>
  <h1>Welcome, {{ user.name }}!</h1>
</div>
`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/greeting/greeting.component.html",
      sourceCode: html,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Welcome, {{name}}!");
    expect(results[0]?.variables).toContain("name");
    expect(results[0]?.variableExpressions?.["name"]).toBe("user.name");
  });

  it("calculates accurate line and column coordinates", () => {
    const html = `<div>\n  <button>Click Here</button>\n</div>`;
    const results = scanHtmlTemplateFile({
      filePath: "src/app/button.component.html",
      sourceCode: html,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.line).toBe(2);
    expect(results[0]?.text).toBe("Click Here");
  });
});
