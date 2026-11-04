import { describe, it, expect } from "vitest";
import {
  maskNeverTranslateTerms,
  unmaskNeverTranslateTerms,
  resolveMandatedTranslation,
  GlossaryTranslationProvider,
  type BrandGlossaryConfig,
} from "../../src/core/translation/glossary-helper.js";
import { DictionaryTranslationProvider } from "../../src/core/translation/translation-provider.js";

describe("Brand Glossary & Never-Translate Safeguards Unit Tests", () => {
  it("masks and unmasks never-translate terms accurately", () => {
    const text = "Connect with Antigravity and pay with Apple Pay or PayPal.";
    const neverTranslate = ["Antigravity", "Apple Pay", "PayPal"];

    const { maskedText, tokens } = maskNeverTranslateTerms(text, neverTranslate);

    expect(maskedText).not.toContain("Antigravity");
    expect(maskedText).not.toContain("Apple Pay");
    expect(maskedText).not.toContain("PayPal");
    expect(tokens.size).toBe(3);

    // Simulate translation modifying surrounding words
    const simulatedTranslated = maskedText.replace("Connect with", "Connectez-vous avec");

    const restored = unmaskNeverTranslateTerms(simulatedTranslated, tokens);
    expect(restored).toBe("Connectez-vous avec Antigravity and pay with Apple Pay or PayPal.");
  });

  it("resolves mandated translations for target locale", () => {
    const terms: BrandGlossaryConfig["terms"] = {
      "Cart": { fr: "Panier", es: "Carrito" },
      "Checkout": "Paiement",
    };

    expect(resolveMandatedTranslation("Cart", "fr", terms)).toBe("Panier");
    expect(resolveMandatedTranslation("Cart", "es", terms)).toBe("Carrito");
    expect(resolveMandatedTranslation("Checkout", "fr", terms)).toBe("Paiement");
    expect(resolveMandatedTranslation("Unknown", "fr", terms)).toBeUndefined();
  });

  it("GlossaryTranslationProvider decorator protects never-translate words and uses mandated terms", async () => {
    const innerProvider = new DictionaryTranslationProvider();
    const glossary: BrandGlossaryConfig = {
      neverTranslate: ["Antigravity"],
      terms: {
        "Shopping Cart": { fr: "Mon Panier" },
      },
    };

    const provider = new GlossaryTranslationProvider(innerProvider, glossary);

    // 1. Mandated term test
    const mandatedResp = await provider.translate({
      text: "Shopping Cart",
      sourceLocale: "en",
      targetLocale: "fr",
    });
    expect(mandatedResp.translatedText).toBe("Mon Panier");
    expect(mandatedResp.confidence).toBe(1.0);

    // 2. Never-translate brand safeguard test
    const brandResp = await provider.translate({
      text: "Save to Antigravity",
      sourceLocale: "en",
      targetLocale: "fr",
    });
    // In French dictionary, "Save" translates to "Enregistrer", while "Antigravity" must be preserved untouched!
    expect(brandResp.translatedText).toContain("Antigravity");
    expect(brandResp.translatedText).toContain("Enregistrer");
  });
});
