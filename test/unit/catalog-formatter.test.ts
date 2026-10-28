import { describe, it, expect } from "vitest";
import {
  sortObjectKeysAlphabetical,
  alignObjectKeysWithSource,
  sortArbCatalog,
} from "../../src/core/format/catalog-formatter.js";
import { parseArb, serializeArb } from "../../src/core/locale/arb-handler.js";

describe("Catalog Formatter & Sorter Unit Tests", () => {
  it("sorts nested JSON keys alphabetically across all levels", () => {
    const unordered = {
      zebra: "striped",
      auth: {
        signup: "Register",
        login: "Sign in",
        forgotPassword: "Reset",
      },
      apple: "fruit",
    };

    const sorted = sortObjectKeysAlphabetical(unordered) as any;

    expect(Object.keys(sorted)).toEqual(["apple", "auth", "zebra"]);
    expect(Object.keys(sorted.auth)).toEqual(["forgotPassword", "login", "signup"]);
  });

  it("aligns target locale keys to match the exact source locale key order", () => {
    const sourceEn = {
      login: "Login",
      signup: "Sign up",
      profile: "Profile",
      settings: "Settings",
    };

    const targetFr = {
      settings: "Paramètres",
      extraKey: "Extra",
      login: "Connexion",
      profile: "Profil",
      signup: "Inscription",
    };

    const aligned = alignObjectKeysWithSource(targetFr, sourceEn) as any;

    // Keys in source should appear in source's exact order, extra keys sorted at the end
    expect(Object.keys(aligned)).toEqual([
      "login",
      "signup",
      "profile",
      "settings",
      "extraKey",
    ]);
  });

  it("sorts ARB catalogs preserving key order and @metadata", () => {
    const rawArb = JSON.stringify({
      "@@locale": "en",
      "zebra": "Zebra",
      "apple": "Apple",
      "@apple": {
        "description": "A delicious red or green fruit"
      }
    });

    const parsed = parseArb(rawArb);
    const sorted = sortArbCatalog(parsed);

    const serialized = serializeArb(sorted);
    const serializedParsed = JSON.parse(serialized);

    const keys = Object.keys(serializedParsed);
    expect(keys[0]).toBe("@@locale");
    expect(keys[1]).toBe("apple");
    expect(keys[2]).toBe("@apple");
    expect(keys[3]).toBe("zebra");
  });
});
