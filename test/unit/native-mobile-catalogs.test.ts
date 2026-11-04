import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import {
  parseXCStrings,
  serializeXCStrings,
  getXCStringValue,
  setXCStringValue,
  getXCStringPlurals,
  setXCStringPlural,
  isXCStringsFile,
  type XCStringCatalog,
} from "../../src/core/locale/xcstrings-handler.js";
import {
  parseAppleStrings,
  serializeAppleStrings,
  isAppleStringsFile,
} from "../../src/core/locale/apple-strings-handler.js";
import {
  parseAndroidStrings,
  serializeAndroidStrings,
  isAndroidStringsFile,
} from "../../src/core/locale/android-strings-handler.js";
import {
  discoverNativeMobileCatalogs,
  updateXCStringsTranslation,
  updateAndroidTranslation,
} from "../../src/core/locale/native-mobile.js";
import { auditPlurals } from "../../src/core/plural/cldr-linter.js";
import { loadExistingTranslations } from "../../src/core/planning/existing-key-resolver.js";

describe("Native Mobile Localization Catalogs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "native-catalogs-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("Apple Xcode 15+ String Catalogs (.xcstrings)", () => {
    it("recognizes .xcstrings file extensions", () => {
      expect(isXCStringsFile("Localizable.xcstrings")).toBe(true);
      expect(isXCStringsFile("path/to/Strings.xcstrings")).toBe(true);
      expect(isXCStringsFile("Localizable.strings")).toBe(false);
      expect(isXCStringsFile("en.json")).toBe(false);
    });

    it("parses and queries string entries and plural variations", () => {
      const sampleXCStrings = JSON.stringify({
        sourceLanguage: "en",
        strings: {
          welcome_message: {
            comment: "Greeting shown on homepage",
            extractionState: "manual",
            localizations: {
              en: {
                stringUnit: { state: "translated", value: "Welcome to our app!" },
              },
              es: {
                stringUnit: { state: "translated", value: "¡Bienvenido a nuestra aplicación!" },
              },
            },
          },
          items_count: {
            comment: "Plural item count",
            localizations: {
              en: {
                variations: {
                  plural: {
                    one: { stringUnit: { state: "translated", value: "%d item" } },
                    other: { stringUnit: { state: "translated", value: "%d items" } },
                  },
                },
              },
            },
          },
        },
        version: "1.0",
      });

      const catalog = parseXCStrings(sampleXCStrings);
      expect(catalog.sourceLanguage).toBe("en");
      expect(catalog.version).toBe("1.0");

      expect(getXCStringValue(catalog, "welcome_message", "en")).toBe("Welcome to our app!");
      expect(getXCStringValue(catalog, "welcome_message", "es")).toBe("¡Bienvenido a nuestra aplicación!");
      expect(getXCStringValue(catalog, "non_existent", "en")).toBeUndefined();

      const enPlurals = getXCStringPlurals(catalog, "items_count", "en");
      expect(enPlurals).toEqual({
        one: "%d item",
        other: "%d items",
      });
    });

    it("mutates and serializes XCStringCatalog with sorted keys", () => {
      const catalog: XCStringCatalog = {
        sourceLanguage: "en",
        version: "1.0",
        strings: {},
      };

      setXCStringValue(catalog, "zebra", "en", "A zebra", "Animal name");
      setXCStringValue(catalog, "apple", "en", "An apple");
      setXCStringPlural(catalog, "cart_items", "en", "one", "1 item");
      setXCStringPlural(catalog, "cart_items", "en", "other", "%d items");

      const serialized = serializeXCStrings(catalog);
      const reparsed = parseXCStrings(serialized);

      expect(Object.keys(reparsed.strings)).toEqual(["apple", "cart_items", "zebra"]);
      expect(getXCStringValue(reparsed, "zebra", "en")).toBe("A zebra");
      expect(getXCStringPlurals(reparsed, "cart_items", "en")?.other).toBe("%d items");
    });
  });

  describe("Apple Legacy .strings Format", () => {
    it("recognizes .strings file extensions", () => {
      expect(isAppleStringsFile("Localizable.strings")).toBe(true);
      expect(isAppleStringsFile("en.lproj/Main.strings")).toBe(true);
      expect(isAppleStringsFile("Localizable.xcstrings")).toBe(false);
    });

    it("parses and serializes .strings key-value pairs with comments and escapes", () => {
      const raw = `
/* Application Header */
"app_title" = "My Awesome App";

// Button Action
"btn_submit" = "Submit \\"Now\\" & Continue";

"multiline_key" = "Line 1\\nLine 2";
`;
      const entries = parseAppleStrings(raw);
      expect(entries).toHaveLength(3);

      expect(entries[0]!.key).toBe("app_title");
      expect(entries[0]!.value).toBe("My Awesome App");
      expect(entries[0]!.comment).toBe("Application Header");

      expect(entries[1]!.key).toBe("btn_submit");
      expect(entries[1]!.value).toBe('Submit "Now" & Continue');
      expect(entries[1]!.comment).toBe("Button Action");

      expect(entries[2]!.key).toBe("multiline_key");
      expect(entries[2]!.value).toBe("Line 1\nLine 2");

      const serialized = serializeAppleStrings(entries);
      expect(serialized).toContain('"btn_submit" = "Submit \\"Now\\" & Continue";');
      expect(serialized).toContain('"multiline_key" = "Line 1\\nLine 2";');

      const reparsed = parseAppleStrings(serialized);
      expect(reparsed[1]!.value).toBe('Submit "Now" & Continue');
    });
  });

  describe("Android XML Resources (strings.xml)", () => {
    it("recognizes Android strings.xml paths", () => {
      expect(isAndroidStringsFile("app/src/main/res/values/strings.xml")).toBe(true);
      expect(isAndroidStringsFile("res/values-es/strings.xml")).toBe(true);
      expect(isAndroidStringsFile("locales/en.json")).toBe(false);
    });

    it("parses <string> and <plurals> XML elements including escapes", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Screen Header -->
    <string name="login_title">Welcome Back!</string>
    <string name="escaped_text">Don\\'t show \\"tips\\" again</string>
    <!-- Order quantity -->
    <plurals name="order_items">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`;

      const catalog = parseAndroidStrings(xml);
      expect(catalog.strings.size).toBe(2);
      expect(catalog.plurals.size).toBe(1);

      const login = catalog.strings.get("login_title");
      expect(login?.value).toBe("Welcome Back!");
      expect(login?.comment).toBe("Screen Header");

      const escaped = catalog.strings.get("escaped_text");
      expect(escaped?.value).toBe("Don't show \"tips\" again");

      const plurals = catalog.plurals.get("order_items");
      expect(plurals?.items.one).toBe("%d item");
      expect(plurals?.items.other).toBe("%d items");
      expect(plurals?.comment).toBe("Order quantity");
    });

    it("serializes AndroidCatalog back to standard XML format", () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">Hello, World!</string>
    <plurals name="messages">
        <item quantity="one">%d message</item>
        <item quantity="other">%d messages</item>
    </plurals>
</resources>`;

      const catalog = parseAndroidStrings(xml);
      catalog.strings.set("new_key", {
        name: "new_key",
        value: "It's a wonderful day",
        translatable: true,
      });

      const serialized = serializeAndroidStrings(catalog);
      expect(serialized).toContain('<string name="greeting">Hello, World!</string>');
      expect(serialized).toContain('<string name="new_key">It\\\'s a wonderful day</string>');
      expect(serialized).toContain('<plurals name="messages">');
      expect(serialized).toContain('<item quantity="other">%d messages</item>');
    });
  });

  describe("Native Catalog Project Discovery", () => {
    it("discovers .xcstrings, Apple .strings, and Android strings.xml across project directory tree", async () => {
      // Create test directory tree
      const iosDir = path.join(tmpDir, "ios", "App");
      const lprojDir = path.join(tmpDir, "ios", "en.lproj");
      const androidResDir = path.join(tmpDir, "android", "app", "src", "main", "res", "values");
      const androidEsDir = path.join(tmpDir, "android", "app", "src", "main", "res", "values-es");

      await fs.mkdir(iosDir, { recursive: true });
      await fs.mkdir(lprojDir, { recursive: true });
      await fs.mkdir(androidResDir, { recursive: true });
      await fs.mkdir(androidEsDir, { recursive: true });

      await fs.writeFile(
        path.join(iosDir, "Localizable.xcstrings"),
        JSON.stringify({ sourceLanguage: "en", strings: {}, version: "1.0" })
      );
      await fs.writeFile(
        path.join(lprojDir, "Localizable.strings"),
        '"hello" = "Hello";\n'
      );
      await fs.writeFile(
        path.join(androidResDir, "strings.xml"),
        '<resources><string name="app_name">My App</string></resources>'
      );
      await fs.writeFile(
        path.join(androidEsDir, "strings.xml"),
        '<resources><string name="app_name">Mi App</string></resources>'
      );

      const discovery = await discoverNativeMobileCatalogs(tmpDir);
      expect(discovery.hasXCStrings).toBe(true);
      expect(discovery.xcstringsFiles).toHaveLength(1);
      expect(discovery.xcstringsFiles[0]).toContain("Localizable.xcstrings");

      expect(discovery.hasAppleStrings).toBe(true);
      expect(discovery.appleStringsFiles).toHaveLength(1);
      expect(discovery.appleStringsFiles[0]).toContain("Localizable.strings");

      expect(discovery.hasAndroidStrings).toBe(true);
      expect(discovery.androidStringsFiles).toHaveLength(2);
    });
  });

  describe("auditPlurals with Native Mobile Catalogs (CLDR Auditing & Auto-Fixing)", () => {
    it("audits Apple String Catalog (.xcstrings) and auto-scaffolds missing Arabic plural categories", async () => {
      // Arabic requires: zero, one, two, few, many, other
      const arCatalogContent = JSON.stringify({
        sourceLanguage: "en",
        strings: {
          unread_notifications: {
            localizations: {
              ar: {
                variations: {
                  plural: {
                    one: { stringUnit: { state: "translated", value: "إشعار واحد" } },
                    other: { stringUnit: { state: "translated", value: "%d إشعارات" } },
                  },
                },
              },
            },
          },
        },
        version: "1.0",
      });

      const xcPath = path.join(tmpDir, "Localizable.xcstrings");
      await fs.writeFile(xcPath, arCatalogContent, "utf8");

      // 1. Audit without fix
      const auditResult = await auditPlurals({
        projectPath: tmpDir,
        locales: ["ar"],
        fix: false,
      });

      expect(auditResult.totalPluralsAudited).toBe(1);
      expect(auditResult.totalIssues).toBeGreaterThanOrEqual(1);

      const missingIssue = auditResult.issues.find(
        (i) => i.key === "unread_notifications" && i.issueType === "MISSING_REQUIRED_PLURAL"
      );
      expect(missingIssue).toBeDefined();
      expect(missingIssue?.format).toBe("XCSTRINGS_PLURAL");
      expect(missingIssue?.missingCategories).toEqual(["zero", "two", "few", "many"]);

      // 2. Audit with fix: true
      const fixResult = await auditPlurals({
        projectPath: tmpDir,
        locales: ["ar"],
        fix: true,
        dryRun: false,
      });

      expect(fixResult.fixesApplied).toBe(4);

      // Verify the updated xcstrings file has all required Arabic categories
      const updatedContent = await fs.readFile(xcPath, "utf8");
      const updatedCatalog = parseXCStrings(updatedContent);
      const arPlurals = getXCStringPlurals(updatedCatalog, "unread_notifications", "ar");

      expect(arPlurals).toBeDefined();
      expect(Object.keys(arPlurals!)).toEqual(
        expect.arrayContaining(["zero", "one", "two", "few", "many", "other"])
      );
    });

    it("audits Android XML <plurals> and auto-scaffolds missing Russian plural categories", async () => {
      // Russian requires: one, few, many, other
      const resValuesRu = path.join(tmpDir, "res", "values-ru");
      await fs.mkdir(resValuesRu, { recursive: true });

      const ruXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="days_count">
        <item quantity="one">%d день</item>
        <item quantity="other">%d дней</item>
    </plurals>
</resources>`;

      const stringsXmlPath = path.join(resValuesRu, "strings.xml");
      await fs.writeFile(stringsXmlPath, ruXml, "utf8");

      // 1. Audit without fix
      const auditResult = await auditPlurals({
        projectPath: tmpDir,
        locales: ["ru"],
        fix: false,
      });

      expect(auditResult.totalPluralsAudited).toBe(1);
      const ruIssue = auditResult.issues.find(
        (i) => i.key === "days_count" && i.issueType === "MISSING_REQUIRED_PLURAL"
      );
      expect(ruIssue).toBeDefined();
      expect(ruIssue?.format).toBe("ANDROID_PLURALS");
      expect(ruIssue?.missingCategories).toEqual(["few", "many"]);

      // 2. Audit with fix: true
      const fixResult = await auditPlurals({
        projectPath: tmpDir,
        locales: ["ru"],
        fix: true,
        dryRun: false,
      });

      expect(fixResult.fixesApplied).toBe(2);

      const updatedXml = await fs.readFile(stringsXmlPath, "utf8");
      const updatedCatalog = parseAndroidStrings(updatedXml);
      const plural = updatedCatalog.plurals.get("days_count");

      expect(plural).toBeDefined();
      expect(Object.keys(plural!.items)).toEqual(
        expect.arrayContaining(["one", "few", "many", "other"])
      );
      expect(plural!.items.few).toBe("%d дней");
      expect(plural!.items.many).toBe("%d дней");
    });
  });

  describe("Native Mobile Catalog Updaters", () => {
    it("updates .xcstrings with a new translation via updateXCStringsTranslation", async () => {
      const xcPath = path.join(tmpDir, "Localizable.xcstrings");
      await fs.writeFile(
        xcPath,
        JSON.stringify({ sourceLanguage: "en", strings: {}, version: "1.0" }),
        "utf8"
      );

      const updateRes = await updateXCStringsTranslation(
        xcPath,
        "signup_btn",
        "fr",
        "S'inscrire",
        "Sign up button label",
        false
      );

      expect(updateRes.modified).toBe(true);
      expect(updateRes.diff).toContain("signup_btn");

      const reparsed = parseXCStrings(await fs.readFile(xcPath, "utf8"));
      expect(getXCStringValue(reparsed, "signup_btn", "fr")).toBe("S'inscrire");
    });

    it("creates/updates Android res/values-<locale>/strings.xml via updateAndroidTranslation", async () => {
      const resDir = path.join(tmpDir, "res");
      await fs.mkdir(resDir, { recursive: true });

      const updateRes = await updateAndroidTranslation(
        resDir,
        "confirm_action",
        "es",
        "Confirmar",
        "Action button",
        false
      );

      expect(updateRes.modified).toBe(true);
      const targetXmlPath = path.join(resDir, "values-es", "strings.xml");
      const xml = await fs.readFile(targetXmlPath, "utf8");
      expect(xml).toContain('<string name="confirm_action">Confirmar</string>');
    });
  });

  describe("loadExistingTranslations with Native Mobile Catalogs", () => {
    it("loads existing strings from .xcstrings and Android strings.xml", async () => {
      const localeDir = path.join(tmpDir, "locales");
      await fs.mkdir(localeDir, { recursive: true });

      // Add .xcstrings
      const xcContent = JSON.stringify({
        sourceLanguage: "en",
        strings: {
          nav_home: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Home" } },
            },
          },
        },
        version: "1.0",
      });
      await fs.writeFile(path.join(localeDir, "Localizable.xcstrings"), xcContent);

      // Add Android strings.xml
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="nav_profile">User Profile</string>
</resources>`;
      await fs.writeFile(path.join(localeDir, "strings.xml"), xmlContent);

      const loaded = await loadExistingTranslations(tmpDir, "locales", "en");
      expect(loaded.items.length).toBeGreaterThanOrEqual(2);

      const homeItem = loaded.items.find((i) => i.key === "nav_home");
      expect(homeItem).toBeDefined();
      expect(homeItem?.value).toBe("Home");

      const profileItem = loaded.items.find((i) => i.key === "nav_profile");
      expect(profileItem).toBeDefined();
      expect(profileItem?.value).toBe("User Profile");
    });
  });
});
