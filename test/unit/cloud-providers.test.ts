import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DeeplTranslationProvider,
  OpenAiTranslationProvider,
  GeminiTranslationProvider,
  SmartTranslationProvider,
  createTranslationProvider,
} from "../../src/core/translation/cloud-providers.js";
import { DictionaryTranslationProvider } from "../../src/core/translation/translation-provider.js";

describe("Cloud Translation Providers & Non-blocking Smart Fallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("DeeplTranslationProvider", () => {
    it("reports not configured when apiKey is missing", async () => {
      const provider = new DeeplTranslationProvider({ apiKey: "" });
      expect(provider.isConfigured()).toBe(false);

      const result = await provider.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "fr",
      });
      expect(result.translated).toBe(false);
      expect(result.translatedText).toBe("Save");
    });

    it("translates text using DeepL API when configured", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          translations: [{ text: "Enregistrer" }],
        }),
      } as any);

      const provider = new DeeplTranslationProvider({ apiKey: "test-api-key:fx" });
      expect(provider.isConfigured()).toBe(true);

      const result = await provider.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "fr",
      });

      expect(result.translated).toBe(true);
      expect(result.translatedText).toBe("Enregistrer");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as any).mock.calls[0];
      expect(url).toBe("https://api-free.deepl.com/v2/translate");
      expect(options.headers.Authorization).toBe("DeepL-Auth-Key test-api-key:fx");
    });

    it("throws error when API returns non-ok status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as any);

      const provider = new DeeplTranslationProvider({ apiKey: "invalid-key" });
      await expect(
        provider.translate({
          text: "Save",
          sourceLocale: "en",
          targetLocale: "fr",
        })
      ).rejects.toThrow("DeepL API error (403)");
    });
  });

  describe("OpenAiTranslationProvider", () => {
    it("reports not configured when apiKey is missing", async () => {
      const provider = new OpenAiTranslationProvider({ apiKey: "" });
      expect(provider.isConfigured()).toBe(false);

      const result = await provider.translate({
        text: "Cancel",
        sourceLocale: "en",
        targetLocale: "es",
      });
      expect(result.translated).toBe(false);
    });

    it("translates using OpenAI chat completions", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Cancelar" } }],
        }),
      } as any);

      const provider = new OpenAiTranslationProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });
      const result = await provider.translate({
        text: "Cancel",
        sourceLocale: "en",
        targetLocale: "es",
      });

      expect(result.translated).toBe(true);
      expect(result.translatedText).toBe("Cancelar");
    });
  });

  describe("GeminiTranslationProvider", () => {
    it("translates using Gemini generateContent", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Abbrechen" }] } }],
        }),
      } as any);

      const provider = new GeminiTranslationProvider({ apiKey: "gemini-key" });
      const result = await provider.translate({
        text: "Cancel",
        sourceLocale: "en",
        targetLocale: "de",
      });

      expect(result.translated).toBe(true);
      expect(result.translatedText).toBe("Abbrechen");
      const [url] = (global.fetch as any).mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
    });
  });

  describe("SmartTranslationProvider (Optional & Non-Blocking Fallback)", () => {
    it("uses local dictionary when cloud provider is not configured or fails", async () => {
      // Mock cloud provider that throws error
      global.fetch = vi.fn().mockRejectedValue(new Error("Network connection failed"));

      const smart = new SmartTranslationProvider(
        new DeeplTranslationProvider({ apiKey: "fail-key" }),
        new DictionaryTranslationProvider()
      );

      // Local dictionary has "Save" -> "Enregistrer" for FR
      const result = await smart.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "fr",
      });

      // Does not throw! Falls back seamlessly to offline dictionary
      expect(result.translated).toBe(true);
      expect(result.translatedText).toBe("Enregistrer");
    });

    it("respects user glossary ahead of both cloud and dictionary", async () => {
      const smart = new SmartTranslationProvider(
        new DeeplTranslationProvider({ apiKey: "mock" }),
        new DictionaryTranslationProvider()
      );

      const result = await smart.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "fr",
        glossary: { Save: "Garder" },
      });

      expect(result.translated).toBe(true);
      expect(result.translatedText).toBe("Garder");
      expect(result.confidence).toBe(1.0);
    });

    it("translates nested ICU MessageFormat plural branches safely", async () => {
      const smart = new SmartTranslationProvider(null, new DictionaryTranslationProvider());

      const icuInput = "{count, plural, =0{no items} =1{1 item} other{{count} items}}";
      const result = await smart.translate({
        text: icuInput,
        sourceLocale: "en",
        targetLocale: "es",
      });

      expect(result.translated).toBe(true);
      // Ensure branches were preserved and parsed properly
      expect(result.translatedText).toContain("{count, plural,");
      expect(result.translatedText).toContain("=0{");
      expect(result.translatedText).toContain("=1{");
      expect(result.translatedText).toContain("other{");
    });

    it("factory createTranslationProvider defaults to non-blocking offline operation when no API keys are provided", async () => {
      const provider = createTranslationProvider();
      const res = await provider.translate({
        text: "Settings",
        sourceLocale: "en",
        targetLocale: "es",
      });

      expect(res.translated).toBe(true);
      expect(res.translatedText).toBe("Ajustes");
    });
  });
});
