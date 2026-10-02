import { describe, it, expect } from "vitest";
import {
  parseArb,
  serializeArb,
  setArbEntry,
  formatIcuPlural,
  isArbFile,
} from "../../src/core/locale/arb-handler.js";
import { prepareLocaleUpdates } from "../../src/core/replacement/locale-updater.js";
import type { TranslationPlan } from "../../src/models/plan.js";

describe("Phase P2: Flutter ARB Handler", () => {
  it("identifies .arb files correctly", () => {
    expect(isArbFile("lib/l10n/app_en.arb")).toBe(true);
    expect(isArbFile("app_es.ARB")).toBe(true);
    expect(isArbFile("locales/en.json")).toBe(false);
  });

  it("parses ARB file preserving @@locale and @metadata", () => {
    const content = `{
      "@@locale": "en",
      "welcomeBack": "Welcome back",
      "@welcomeBack": {
        "description": "Greeting on dashboard"
      }
    }`;

    const arb = parseArb(content);
    expect(arb.locale).toBe("en");
    expect(arb.entries.get("welcomeBack")).toBe("Welcome back");
    expect(arb.keyMetadata.get("welcomeBack")).toEqual({
      description: "Greeting on dashboard",
    });
  });

  it("formats ICU plurals for ARB files", () => {
    const icu = formatIcuPlural({
      one: "{{count}} item",
      other: "{{count}} items",
    });
    expect(icu).toBe("{count, plural, =1{{count} item} other{{count} items}}");
  });

  it("sets ARB entries with placeholders and serializes back to valid JSON", () => {
    const content = `{\n  "@@locale": "en"\n}`;
    const arb = parseArb(content);

    setArbEntry(arb, "greetingUser", "Hello {name}!");
    const serialized = serializeArb(arb);

    expect(serialized).toContain('"@@locale": "en"');
    expect(serialized).toContain('"greetingUser": "Hello {name}!"');
    expect(serialized).toContain('"@greetingUser":');
    expect(serialized).toContain('"description": "Translation for greetingUser"');
  });

  it("updates ARB files in prepareLocaleUpdates without breaking @@locale metadata", async () => {
    const plans: TranslationPlan[] = [
      {
        action: "CREATE",
        namespace: "app_en",
        key: "itemCount",
        isPlural: true,
        pluralVariable: "count",
        pluralForm: {
          one: "{{count}} item",
          other: "{{count}} items",
        },
        sourceLocale: {
          locale: "en",
          value: "{{count}} items",
          filePath: "lib/l10n/app_en.arb",
        },
        targets: [],
        occurrences: 1,
      },
    ];

    const result = await prepareLocaleUpdates("dummy-project", plans);
    const updatedContent = result.stagedFiles.get("lib/l10n/app_en.arb");
    expect(updatedContent).toBeDefined();

    const parsed = JSON.parse(updatedContent!);
    expect(parsed.itemCount).toBe("{count, plural, =1{{count} item} other{{count} items}}");
    expect(parsed["@itemCount"]).toBeDefined();
    expect(result.translationEntriesCreated).toBe(1);
  });
});
