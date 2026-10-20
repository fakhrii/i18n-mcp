import { describe, it, expect } from "vitest";
import {
  formatIcuPlural,
  setArbEntry,
  parseArb,
  serializeArb,
} from "../../src/core/locale/arb-handler.js";
import { prepareLocaleUpdates } from "../../src/core/replacement/locale-updater.js";
import type { TranslationPlan } from "../../src/models/plan.js";

describe("ICU MessageFormat Parity (Flutter ARB & Next-intl Plurals)", () => {
  describe("Flutter ARB ICU formatting and placeholder metadata", () => {
    it("formats ICU plurals with zero, one, and other branches", () => {
      const icuWithZero = formatIcuPlural({
        zero: "no items",
        one: "1 item",
        other: "{{count}} items",
      });
      expect(icuWithZero).toBe(
        "{count, plural, =0{no items} =1{1 item} other{{count} items}}"
      );

      const icuWithoutZero = formatIcuPlural({
        one: "{{count}} item",
        other: "{{count}} items",
      });
      expect(icuWithoutZero).toBe(
        "{count, plural, =1{{count} item} other{{count} items}}"
      );
    });

    it("automatically populates @key.placeholders for ICU plurals in Flutter ARB", () => {
      const arb = parseArb(JSON.stringify({ "@@locale": "en" }));
      const icu = formatIcuPlural({
        zero: "0 notifications",
        one: "1 notification",
        other: "{{count}} notifications",
      });

      setArbEntry(arb, "unreadNotifications", icu);

      expect(arb.entries.get("unreadNotifications")).toBe(icu);
      const meta = arb.keyMetadata.get("unreadNotifications");
      expect(meta).toBeDefined();
      expect(meta?.placeholders).toBeDefined();
      expect(meta?.placeholders?.count).toEqual({
        type: "num",
        format: "compact",
      });
    });

    it("automatically populates @key.placeholders for String interpolations", () => {
      const arb = parseArb(JSON.stringify({ "@@locale": "en" }));
      setArbEntry(arb, "welcomeUser", "Hello {{name}}, welcome to {{appName}}!");

      expect(arb.entries.get("welcomeUser")).toBe("Hello {name}, welcome to {appName}!");
      const meta = arb.keyMetadata.get("welcomeUser");
      expect(meta).toBeDefined();
      expect(meta?.placeholders).toEqual({
        name: { type: "String" },
        appName: { type: "String" },
      });
    });

    it("serializes ARB catalog with @metadata and @@locale intact", () => {
      const arb = parseArb(JSON.stringify({ "@@locale": "es" }));
      setArbEntry(arb, "itemCount", "{count, plural, =1{1 elemento} other{{count} elementos}}");
      const output = serializeArb(arb);

      expect(output).toContain('"@@locale": "es"');
      expect(output).toContain('"itemCount": "{count, plural, =1{1 elemento} other{{count} elementos}}"');
      expect(output).toContain('"@itemCount":');
      expect(output).toContain('"count": {');
      expect(output).toContain('"type": "num"');
    });
  });

  describe("Next-intl vs react-i18next Plural Catalog Strategy", () => {
    it("generates single ICU key for Next.js (next-intl / messages/*.json)", async () => {
      const plans: TranslationPlan[] = [
        {
          action: "CREATE",
          namespace: "messages",
          key: "cartItems",
          isPlural: true,
          pluralVariable: "count",
          pluralForm: {
            zero: "Your cart is empty",
            one: "1 item in your cart",
            other: "{{count}} items in your cart",
          },
          sourceLocale: {
            locale: "en",
            value: "{{count}} items in your cart",
            filePath: "messages/en.json",
          },
          targets: [],
          occurrences: 1,
        },
      ];

      const result = await prepareLocaleUpdates("/test/project", plans, "flat", "nextjs");
      expect(result.translationEntriesCreated).toBe(1);
      expect(result.stagedFiles.has("messages/en.json")).toBe(true);

      const parsed = JSON.parse(result.stagedFiles.get("messages/en.json")!);
      expect(parsed.cartItems).toBe(
        "{count, plural, =0{Your cart is empty} =1{1 item in your cart} other{{count} items in your cart}}"
      );
      expect(parsed.cartItems_one).toBeUndefined();
      expect(parsed.cartItems_other).toBeUndefined();
    });

    it("generates _one and _other separate keys for standard react-i18next", async () => {
      const plans: TranslationPlan[] = [
        {
          action: "CREATE",
          namespace: "common",
          key: "cartItems",
          isPlural: true,
          pluralVariable: "count",
          pluralForm: {
            one: "1 item in your cart",
            other: "{{count}} items in your cart",
          },
          sourceLocale: {
            locale: "en",
            value: "{{count}} items in your cart",
            filePath: "locales/en/common.json",
          },
          targets: [],
          occurrences: 1,
        },
      ];

      const result = await prepareLocaleUpdates("/test/project", plans, "flat", "react");
      expect(result.translationEntriesCreated).toBe(2);
      expect(result.stagedFiles.has("locales/en/common.json")).toBe(true);

      const parsed = JSON.parse(result.stagedFiles.get("locales/en/common.json")!);
      expect(parsed.cartItems_one).toBe("1 item in your cart");
      expect(parsed.cartItems_other).toBe("{{count}} items in your cart");
      expect(parsed.cartItems).toBeUndefined();
    });
  });
});
