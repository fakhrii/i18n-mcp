import { describe, it, expect } from "vitest";
import {
  getNestedValue,
  setNestedValue,
  hasNestedKey,
  isNestedJsonObject,
  flattenNestedObject,
  findMatchingPropertyKey,
  deleteNestedValue,
} from "../../src/utils/nested-json.js";

describe("nested-json utilities", () => {
  describe("findMatchingPropertyKey", () => {
    it("matches exact keys first", () => {
      const obj = { PISPI: { title: "Test" } };
      expect(findMatchingPropertyKey(obj, "PISPI")).toBe("PISPI");
    });

    it("matches case-insensitively when exact key is missing", () => {
      const obj = { PISPI: { HERO_TITLE: "Title" } };
      expect(findMatchingPropertyKey(obj, "pispi")).toBe("PISPI");
      expect(findMatchingPropertyKey(obj, "Pispi")).toBe("PISPI");
    });

    it("returns undefined if no key matches", () => {
      const obj = { PISPI: 123 };
      expect(findMatchingPropertyKey(obj, "other")).toBeUndefined();
    });
  });

  describe("getNestedValue and hasNestedKey", () => {
    const sample = {
      PISPI: {
        ONBOARDING: {
          HERO_TITLE: "",
          SUBTITLE: "Welcome to Pispi",
        },
      },
      "FLAT.KEY": "flat value",
    };

    it("retrieves direct flat property", () => {
      expect(getNestedValue(sample, "FLAT.KEY")).toBe("flat value");
      expect(hasNestedKey(sample, "FLAT.KEY")).toBe(true);
    });

    it("retrieves deep nested value", () => {
      expect(getNestedValue(sample, "PISPI.ONBOARDING.SUBTITLE")).toBe("Welcome to Pispi");
      expect(hasNestedKey(sample, "PISPI.ONBOARDING.SUBTITLE")).toBe(true);
    });

    it("retrieves empty string placeholders correctly without treating as undefined", () => {
      expect(getNestedValue(sample, "PISPI.ONBOARDING.HERO_TITLE")).toBe("");
      expect(hasNestedKey(sample, "PISPI.ONBOARDING.HERO_TITLE")).toBe(true);
    });

    it("retrieves nested value case-insensitively", () => {
      expect(getNestedValue(sample, "pispi.onboarding.subtitle")).toBe("Welcome to Pispi");
      expect(getNestedValue(sample, "pispi.onboarding.hero_title")).toBe("");
    });

    it("returns undefined for non-existent path", () => {
      expect(getNestedValue(sample, "PISPI.ONBOARDING.UNKNOWN")).toBeUndefined();
      expect(hasNestedKey(sample, "PISPI.ONBOARDING.UNKNOWN")).toBe(false);
      expect(getNestedValue(sample, "UNKNOWN.PATH")).toBeUndefined();
    });
  });

  describe("setNestedValue", () => {
    it("updates empty placeholder in-place without deleting siblings or creating flat keys", () => {
      const locale = {
        PISPI: {
          ONBOARDING: {
            HERO_TITLE: "",
            SUBTITLE: "Existing Subtitle",
          },
        },
      };

      setNestedValue(locale, "PISPI.ONBOARDING.HERO_TITLE", "New Hero Title");

      // Verify HERO_TITLE is updated in-place
      expect(locale.PISPI.ONBOARDING.HERO_TITLE).toBe("New Hero Title");
      // Sibling is preserved
      expect(locale.PISPI.ONBOARDING.SUBTITLE).toBe("Existing Subtitle");
      // No flat key created
      expect((locale.PISPI as any)["ONBOARDING.HERO_TITLE"]).toBeUndefined();
      expect((locale as any)["PISPI.ONBOARDING.HERO_TITLE"]).toBeUndefined();
    });

    it("updates empty placeholder with case-insensitive path and preserves existing schema casing", () => {
      const locale = {
        PISPI: {
          ONBOARDING: {
            HERO_TITLE: "",
          },
        },
      };

      setNestedValue(locale, "pispi.onboarding.hero_title", "Populated Title");

      expect(locale.PISPI.ONBOARDING.HERO_TITLE).toBe("Populated Title");
      expect((locale as any).pispi).toBeUndefined();
    });

    it("adds new nested sibling property without corrupting existing object", () => {
      const locale: Record<string, any> = {
        PISPI: {
          ONBOARDING: {
            HERO_TITLE: "Title",
          },
        },
      };

      setNestedValue(locale, "PISPI.ONBOARDING.BUTTON_START", "Get Started");

      expect(locale.PISPI.ONBOARDING.HERO_TITLE).toBe("Title");
      expect(locale.PISPI.ONBOARDING.BUTTON_START).toBe("Get Started");
      expect(locale["PISPI.ONBOARDING.BUTTON_START"]).toBeUndefined();
    });

    it("adds a new nested section under an existing parent namespace", () => {
      const locale: Record<string, any> = {
        PISPI: {
          ONBOARDING: {
            HERO_TITLE: "Title",
          },
        },
      };

      setNestedValue(locale, "PISPI.AUTH.LOGIN_BUTTON", "Log In");

      expect(locale.PISPI.ONBOARDING.HERO_TITLE).toBe("Title");
      expect(locale.PISPI.AUTH.LOGIN_BUTTON).toBe("Log In");
    });

    it("updates existing flat dotted keys flat if already present", () => {
      const locale: Record<string, any> = {
        "onboarding.hero_title": "Old Flat",
      };

      setNestedValue(locale, "onboarding.hero_title", "Updated Flat");

      expect(locale["onboarding.hero_title"]).toBe("Updated Flat");
      expect(locale.onboarding).toBeUndefined();
    });
  });

  describe("isNestedJsonObject and flattenNestedObject", () => {
    it("detects nested objects", () => {
      expect(isNestedJsonObject({ PISPI: { a: "1" } })).toBe(true);
      expect(isNestedJsonObject({ flat: "val" })).toBe(false);
      expect(isNestedJsonObject({})).toBe(false);
    });

    it("recursively flattens deeply nested structures into dot-separated keys", () => {
      const nested = {
        PISPI: {
          ONBOARDING: {
            HERO_TITLE: "Welcome",
            STEP_COUNT: 3,
            IS_ACTIVE: true,
          },
        },
      };

      const flat = flattenNestedObject(nested);
      expect(flat.get("PISPI.ONBOARDING.HERO_TITLE")).toBe("Welcome");
      expect(flat.get("PISPI.ONBOARDING.STEP_COUNT")).toBe("3");
      expect(flat.get("PISPI.ONBOARDING.IS_ACTIVE")).toBe("true");
    });
  });

  describe("Prototype Pollution Security", () => {
    it("prevents modifying Object.prototype via setNestedValue", () => {
      const target: Record<string, unknown> = {};
      setNestedValue(target, "__proto__.polluted", "hacked");
      setNestedValue(target, "constructor.prototype.polluted2", "hacked");

      expect((target as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).polluted2).toBeUndefined();
    });

    it("returns undefined when querying dangerous prototype properties via getNestedValue", () => {
      const target: Record<string, unknown> = { safe: "value" };
      expect(getNestedValue(target, "__proto__")).toBeUndefined();
      expect(getNestedValue(target, "__proto__.polluted")).toBeUndefined();
      expect(getNestedValue(target, "constructor.prototype.polluted")).toBeUndefined();
    });

    it("does not delete prototype properties via deleteNestedValue", () => {
      const target: Record<string, unknown> = {};
      expect(deleteNestedValue(target, "__proto__")).toBe(false);
      expect(deleteNestedValue(target, "__proto__.toString")).toBe(false);
      expect(deleteNestedValue(target, "constructor.prototype")).toBe(false);
    });
  });
});
