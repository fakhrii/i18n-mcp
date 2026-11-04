import { describe, it, expect } from "vitest";
import {
  pseudolocalizeString,
  pseudolocalizeObject,
  pseudolocalizeArb,
} from "../../src/core/pseudolocale/pseudolocalizer.js";
import { parseArb } from "../../src/core/locale/arb-handler.js";

describe("Pseudo-Localization Engine Unit Tests", () => {
  it("pseudolocalizes English text with accented characters and expansion", () => {
    const input = "Welcome to our application";
    const result = pseudolocalizeString(input, {
      strategy: "all",
      expansionRatio: 0.35,
      delimiter: "exclamation",
    });

    expect(result.startsWith("[!! ")).toBe(true);
    expect(result.endsWith(" !!]")).toBe(true);
    // Should contain accented letters (e.g. Ŵ, é, ļ, ç, ø, ɱ)
    expect(result).toMatch(/[Ŵéļçømå]/);
    // Should be longer than original due to expansion
    expect(result.length).toBeGreaterThan(input.length + 10);
  });

  it("safely preserves interpolation tokens {{var}} and {count}", () => {
    const input = "Hello {{username}}, you have {count} unread notifications!";
    const result = pseudolocalizeString(input, {
      strategy: "all",
      delimiter: "brackets",
    });

    expect(result.startsWith("[")).toBe(true);
    expect(result.endsWith("]")).toBe(true);
    // Tokens must be strictly intact
    expect(result).toContain("{{username}}");
    expect(result).toContain("{count}");
  });

  it("safely preserves HTML tags and URLs", () => {
    const input = 'Click <a href="https://example.com">here</a> for details.';
    const result = pseudolocalizeString(input, {
      strategy: "accented",
      delimiter: "none",
    });

    expect(result).toContain('<a href="https://example.com">');
    expect(result).toContain("</a>");
  });

  it("handles bidi / RTL mirroring strategy", () => {
    const input = "Settings and Profile";
    const result = pseudolocalizeString(input, {
      strategy: "bidi",
      delimiter: "brackets",
    });

    expect(result).toContain("\u202B"); // Right-to-Left marker
    expect(result).toContain("\u202C");
  });

  it("recursively pseudolocalizes nested JSON catalogs", () => {
    const catalog = {
      auth: {
        login: "Log In",
        forgot: "Forgot Password?",
      },
      common: {
        save: "Save",
        actions: ["Confirm", "Cancel"],
      },
    };

    const pseudo = pseudolocalizeObject(catalog) as any;

    expect(pseudo.auth.login.startsWith("[!! ")).toBe(true);
    expect(pseudo.auth.forgot.startsWith("[!! ")).toBe(true);
    expect(pseudo.common.save.startsWith("[!! ")).toBe(true);
    expect(pseudo.common.actions[0].startsWith("[!! ")).toBe(true);
  });

  it("pseudolocalizes ARB files preserving @@locale and @metadata", () => {
    const arbRaw = JSON.stringify({
      "@@locale": "en",
      "greeting": "Hello {name}",
      "@greeting": {
        "description": "User greeting",
        "placeholders": {
          "name": { "type": "String" }
        }
      }
    });

    const parsed = parseArb(arbRaw);
    const pseudoArb = pseudolocalizeArb(parsed, { delimiter: "brackets" });

    expect(pseudoArb.entries.get("greeting")).toContain("{name}");
    expect(pseudoArb.entries.get("greeting")?.startsWith("[")).toBe(true);
    expect(pseudoArb.keyMetadata.get("greeting")?.description).toBe("User greeting");
  });
});
