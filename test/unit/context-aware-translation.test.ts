import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  inferRoleFromKey,
  buildContextPrompt,
  type TranslationContext,
} from "../../src/core/translation/context-helper.js";
import {
  OpenAiTranslationProvider,
  GeminiTranslationProvider,
  DeeplTranslationProvider,
} from "../../src/core/translation/cloud-providers.js";
import { translateI18n } from "../../src/core/translation/translation-service.js";
import type { ITranslationProvider, TranslationRequest } from "../../src/core/translation/translation-provider.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Context-Aware LLM Translation Prompting", () => {
  describe("inferRoleFromKey", () => {
    it("should infer button roles from common key naming conventions", () => {
      expect(inferRoleFromKey("SAVE_BUTTON")).toBe("BUTTON (interactive action label)");
      expect(inferRoleFromKey("submit_btn")).toBe("BUTTON (interactive action label)");
      expect(inferRoleFromKey("BTN_CANCEL")).toBe("BUTTON (interactive action label)");
      expect(inferRoleFromKey("checkout_action")).toBe("BUTTON (interactive action label)");
    });

    it("should infer title, placeholder, and error roles", () => {
      expect(inferRoleFromKey("welcome_title")).toBe("TITLE (page, modal, or section header)");
      expect(inferRoleFromKey("card_header")).toBe("TITLE (page, modal, or section header)");
      expect(inferRoleFromKey("search_placeholder")).toBe("PLACEHOLDER (input field prompt)");
      expect(inferRoleFromKey("hint_username")).toBe("PLACEHOLDER (input field prompt)");
      expect(inferRoleFromKey("network_error")).toBe("ERROR_MESSAGE (alert or validation warning)");
      expect(inferRoleFromKey("ERR_INVALID_EMAIL")).toBe("ERROR_MESSAGE (alert or validation warning)");
      expect(inferRoleFromKey("input_invalid")).toBe("ERROR_MESSAGE (alert or validation warning)");
    });

    it("should infer tooltips, descriptions, navigation, and success feedback", () => {
      expect(inferRoleFromKey("password_tooltip")).toBe("TOOLTIP (help/explanatory popover text)");
      expect(inferRoleFromKey("help_info")).toBe("TOOLTIP (help/explanatory popover text)");
      expect(inferRoleFromKey("order_success")).toBe("SUCCESS_MESSAGE (confirmation feedback)");
      expect(inferRoleFromKey("plan_desc")).toBe("DESCRIPTION (secondary body explanation)");
      expect(inferRoleFromKey("home_tab")).toBe("NAVIGATION (tab, menu, or bar item)");
      expect(inferRoleFromKey("main_nav")).toBe("NAVIGATION (tab, menu, or bar item)");
    });

    it("should return undefined for generic or unclassified keys", () => {
      expect(inferRoleFromKey("greeting")).toBeUndefined();
      expect(inferRoleFromKey("item_count")).toBeUndefined();
    });
  });

  describe("buildContextPrompt", () => {
    it("should return empty string for undefined or empty context", () => {
      expect(buildContextPrompt(undefined)).toBe("");
      expect(buildContextPrompt({})).toBe("");
    });

    it("should format all contextual fields cleanly", () => {
      const context: TranslationContext = {
        role: "BUTTON (interactive action label)",
        componentName: "FlightSearchCard",
        elementTag: "button",
        propName: "aria-label",
        filePath: "src/components/FlightSearchCard.tsx",
        description: "Action to book flight now, not a book noun",
        formality: "formal",
        maxLength: 25,
        surroundingText: "From New York to Paris",
      };

      const prompt = buildContextPrompt(context);

      expect(prompt).toContain("UI Role: BUTTON (interactive action label)");
      expect(prompt).toContain("Component: <FlightSearchCard>");
      expect(prompt).toContain("Element: <button>");
      expect(prompt).toContain("Attribute/Prop: aria-label");
      expect(prompt).toContain("File Source: src/components/FlightSearchCard.tsx");
      expect(prompt).toContain("Context/Note: Action to book flight now, not a book noun");
      expect(prompt).toContain("Grammatical Formality: Formal (use polite/formal address");
      expect(prompt).toContain("Length Constraint: Keep translation within ~25 characters");
      expect(prompt).toContain('Surrounding UI Context: "From New York to Paris"');
      expect(prompt).toContain("Use this context to accurately resolve polysemy");
    });

    it("should handle informal tone instruction", () => {
      const prompt = buildContextPrompt({
        formality: "informal",
      });
      expect(prompt).toContain("Grammatical Formality: Informal (use casual/friendly address");
    });

    it("should omit neutral tone instruction", () => {
      const prompt = buildContextPrompt({
        formality: "neutral",
        role: "LABEL",
      });
      expect(prompt).not.toContain("Grammatical Formality");
      expect(prompt).toContain("UI Role: LABEL");
    });
  });

  describe("Cloud Providers Integration with Context", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should pass context into OpenAiTranslationProvider system prompt", async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Réserver maintenant" } }],
          }),
        };
      });

      const provider = new OpenAiTranslationProvider({
        apiKey: "sk-mock-key",
      });

      const res = await provider.translate({
        text: "Book Now",
        sourceLocale: "en",
        targetLocale: "fr",
        context: {
          role: "BUTTON (interactive action label)",
          formality: "formal",
          componentName: "HotelBooking",
        },
      });

      expect(res.translatedText).toBe("Réserver maintenant");
      expect(capturedBody).toBeDefined();
      const systemMessage = capturedBody.messages.find((m: any) => m.role === "system");
      expect(systemMessage.content).toContain("UI Role: BUTTON");
      expect(systemMessage.content).toContain("Component: <HotelBooking>");
      expect(systemMessage.content).toContain("Grammatical Formality: Formal");
    });

    it("should pass context into GeminiTranslationProvider prompt", async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Schließen" } ] } }],
          }),
        };
      });

      const provider = new GeminiTranslationProvider({
        apiKey: "AIza-mock-key",
      });

      const res = await provider.translate({
        text: "Close",
        sourceLocale: "en",
        targetLocale: "de",
        context: {
          role: "BUTTON (interactive action label)",
          description: "Dismiss modal action, not proximity",
        },
      });

      expect(res.translatedText).toBe("Schließen");
      const userText = capturedBody.contents[0].parts[0].text;
      expect(userText).toContain("UI Role: BUTTON");
      expect(userText).toContain("Context/Note: Dismiss modal action, not proximity");
      expect(userText).toContain("Close");
    });

    it("should pass context and formality into DeeplTranslationProvider payload", async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            translations: [{ text: "Buchen Sie jetzt" }],
          }),
        };
      });

      const provider = new DeeplTranslationProvider({
        apiKey: "mock-deepl-key:fx",
      });

      const res = await provider.translate({
        text: "Book now",
        sourceLocale: "en",
        targetLocale: "de",
        context: {
          role: "BUTTON",
          componentName: "Reservation",
          formality: "formal",
          description: "Flight reservation action",
        },
      });

      expect(res.translatedText).toBe("Buchen Sie jetzt");
      expect(capturedBody.target_lang).toBe("DE");
      expect(capturedBody.formality).toBe("more");
      expect(capturedBody.context).toContain("Flight reservation action");
      expect(capturedBody.context).toContain("UI role: BUTTON");
      expect(capturedBody.context).toContain("Component: Reservation");
    });
  });

  describe("translateI18n Context Enrichment", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-trans-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should enrich ARB translation requests with @description and inferred button role", async () => {
      const l10nDir = path.join(tempDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });

      // Source ARB with @book_flight_btn description
      const sourceArb = {
        "@@locale": "en",
        "book_flight_btn": "Book",
        "@book_flight_btn": {
          "description": "Flight booking call-to-action button, verb form",
        },
      };
      await fs.writeFile(path.join(l10nDir, "app_en.arb"), JSON.stringify(sourceArb, null, 2), "utf8");

      const capturedRequests: TranslationRequest[] = [];
      const mockProvider: ITranslationProvider = {
        async translate(req: TranslationRequest) {
          capturedRequests.push(req);
          return {
            translatedText: "Réserver",
            translated: true,
            confidence: 0.99,
          };
        },
      };

      const result = await translateI18n(
        {
          projectPath: tempDir,
          sourceLocale: "en",
          targetLocales: ["fr"],
          formality: "formal",
        },
        { provider: mockProvider }
      );

      expect(result.translated).toBe(1);
      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0]!;
      expect(req.key).toBe("book_flight_btn");
      expect(req.context).toBeDefined();
      expect(req.context?.role).toBe("BUTTON (interactive action label)");
      expect(req.context?.description).toBe("Flight booking call-to-action button, verb form");
      expect(req.context?.formality).toBe("formal");
    });

    it("should enrich JSON translation requests with inferred role and formality", async () => {
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });

      const sourceJson = {
        common: {
          save_button: "Save",
          email_placeholder: "Enter your email",
        },
      };
      await fs.writeFile(path.join(localesDir, "en.json"), JSON.stringify(sourceJson, null, 2), "utf8");

      const capturedRequests: TranslationRequest[] = [];
      const mockProvider: ITranslationProvider = {
        async translate(req: TranslationRequest) {
          capturedRequests.push(req);
          return {
            translatedText: "translated",
            translated: true,
            confidence: 0.95,
          };
        },
      };

      const result = await translateI18n(
        {
          projectPath: tempDir,
          sourceLocale: "en",
          targetLocales: ["es"],
          formality: "informal",
        },
        { provider: mockProvider }
      );

      expect(result.translated).toBe(2);
      expect(capturedRequests).toHaveLength(2);

      const saveReq = capturedRequests.find((r) => r.key === "save_button");
      expect(saveReq?.context?.role).toBe("BUTTON (interactive action label)");
      expect(saveReq?.context?.formality).toBe("informal");

      const placeholderReq = capturedRequests.find((r) => r.key === "email_placeholder");
      expect(placeholderReq?.context?.role).toBe("PLACEHOLDER (input field prompt)");
      expect(placeholderReq?.context?.formality).toBe("informal");
    });
  });
});
