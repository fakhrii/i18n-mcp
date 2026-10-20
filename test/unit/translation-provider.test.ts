import { describe, it, expect } from "vitest";
import { DictionaryTranslationProvider } from "../../src/core/translation/translation-provider.js";

describe("DictionaryTranslationProvider Unit Tests", () => {
  const provider = new DictionaryTranslationProvider();

  it("translates basic phrases to French", async () => {
    const res = await provider.translate({
      text: "Save",
      sourceLocale: "en",
      targetLocale: "fr",
    });

    expect(res.translated).toBe(true);
    expect(res.translatedText).toBe("Enregistrer");
  });

  it("preserves placeholders containing variables and dollar signs", async () => {
    const res = await provider.translate({
      text: "Save ${count} items",
      sourceLocale: "en",
      targetLocale: "fr",
    });

    expect(res.translated).toBe(true);
    expect(res.translatedText).toContain("${count}");
    expect(res.translatedText).toMatch(/^Enregistrer/);
  });

  it("safely handles dollar signs and $1 / $& in glossary and phrase replacements", async () => {
    // Glossary with $1 or $& replacement tokens
    const res = await provider.translate({
      text: "Special Deal",
      sourceLocale: "en",
      targetLocale: "fr",
      glossary: {
        "special deal": "Offre à $100 & $1",
      },
    });

    expect(res.translated).toBe(true);
    expect(res.translatedText).toBe("Offre à $100 & $1");
  });

  it("safely replaces multiple occurrences without regex lastIndex issues", async () => {
    const res = await provider.translate({
      text: "Cancel and Back or Cancel",
      sourceLocale: "en",
      targetLocale: "fr",
    });

    expect(res.translated).toBe(true);
    // Both "Cancel" occurrences should be replaced with "Annuler", "Back" with "Retour"
    expect(res.translatedText).toBe("Annuler and Retour or Annuler");
  });
});
