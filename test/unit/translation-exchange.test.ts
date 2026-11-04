import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildXliff12,
  buildXliff20,
  parseXliff,
  buildTmx14,
  parseTmx,
  exportTranslations,
  importTranslations,
} from "../../src/core/exchange/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("XLIFF & TMX Translation Exchange Engine", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "exchange-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("XLIFF 1.2 Builder & Parser", () => {
    it("should serialize and parse XLIFF 1.2 preserving entities and notes", () => {
      const xml = buildXliff12({
        sourceLocale: "en",
        targetLocale: "fr",
        units: [
          {
            id: "auth.login_title",
            source: "Welcome & Login <Now>!",
            target: "Bienvenue & Connexion <Maintenant>!",
            note: "Greeting header on authentication screen",
            state: "translated",
          },
          {
            id: "auth.forgot_password",
            source: "Forgot password?",
            state: "needs-translation",
          },
        ],
      });

      expect(xml).toContain('<xliff version="1.2"');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;Now&gt;');

      const parsed = parseXliff(xml);
      expect(parsed.version).toBe("1.2");
      expect(parsed.sourceLocale).toBe("en");
      expect(parsed.targetLocale).toBe("fr");
      expect(parsed.units).toHaveLength(2);

      const u1 = parsed.units[0]!;
      expect(u1.id).toBe("auth.login_title");
      expect(u1.source).toBe("Welcome & Login <Now>!");
      expect(u1.target).toBe("Bienvenue & Connexion <Maintenant>!");
      expect(u1.note).toBe("Greeting header on authentication screen");
      expect(u1.state).toBe("translated");

      const u2 = parsed.units[1]!;
      expect(u2.id).toBe("auth.forgot_password");
      expect(u2.source).toBe("Forgot password?");
      expect(u2.state).toBe("needs-translation");
    });
  });

  describe("XLIFF 2.0 Builder & Parser", () => {
    it("should serialize and parse XLIFF 2.0 modular format", () => {
      const xml = buildXliff20({
        sourceLocale: "en",
        targetLocale: "de",
        units: [
          {
            id: "checkout.pay_now",
            source: "Pay Now",
            target: "Jetzt bezahlen",
            note: "Primary payment CTA",
            state: "translated",
          },
        ],
      });

      expect(xml).toContain('<xliff version="2.0"');
      expect(xml).toContain('<unit id="checkout.pay_now">');

      const parsed = parseXliff(xml);
      expect(parsed.version).toBe("2.0");
      expect(parsed.sourceLocale).toBe("en");
      expect(parsed.targetLocale).toBe("de");
      expect(parsed.units).toHaveLength(1);
      expect(parsed.units[0]?.target).toBe("Jetzt bezahlen");
      expect(parsed.units[0]?.note).toBe("Primary payment CTA");
    });
  });

  describe("TMX 1.4 Builder & Parser", () => {
    it("should serialize and parse TMX 1.4 Translation Memory format", () => {
      const xml = buildTmx14({
        sourceLocale: "en",
        targetLocale: "es",
        units: [
          {
            id: "nav.home",
            source: "Home",
            target: "Inicio",
            note: "Bottom navigation tab",
          },
        ],
      });

      expect(xml).toContain('<tmx version="1.4">');
      expect(xml).toContain('<tu tuid="nav.home">');
      expect(xml).toContain('<tuv xml:lang="es">');

      const parsed = parseTmx(xml, "es");
      expect(parsed.sourceLocale).toBe("en");
      expect(parsed.units).toHaveLength(1);
      expect(parsed.units[0]?.id).toBe("nav.home");
      expect(parsed.units[0]?.source).toBe("Home");
      expect(parsed.units[0]?.target).toBe("Inicio");
    });
  });

  describe("End-to-End Export Translations", () => {
    it("should export project JSON catalogs into XLIFF 1.2 files", async () => {
      const pkg = { name: "test-app", dependencies: { "react-i18next": "^12.0.0" } };
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg), "utf8");

      const localesDir = path.join(tmpDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });

      const enCatalog = {
        title: "Hello World",
        actions: {
          save: "Save",
          cancel: "Cancel",
        },
      };
      await fs.writeFile(path.join(localesDir, "en.json"), JSON.stringify(enCatalog, null, 2), "utf8");

      const exportDir = path.join(tmpDir, "out-xliff");
      const result = await exportTranslations({
        projectPath: tmpDir,
        format: "xliff-1.2",
        targetLocales: ["fr"],
        outputPath: exportDir,
      });

      expect(result.format).toBe("xliff-1.2");
      expect(result.sourceLocale).toBe("en");
      expect(result.targetLocales).toContain("fr");
      expect(result.totalUnitsExported).toBe(3);
      expect(result.filesExported).toHaveLength(1);

      const exportedFile = path.join(tmpDir, result.filesExported[0]!);
      const content = await fs.readFile(exportedFile, "utf8");
      expect(content).toContain("<source>Hello World</source>");
      expect(content).toContain("<source>Save</source>");
    });

    it("should extract Flutter ARB descriptions as XLIFF notes", async () => {
      const pubspec = `
name: flutter_app
dependencies:
  flutter:
    sdk: flutter
`;
      await fs.writeFile(path.join(tmpDir, "pubspec.yaml"), pubspec, "utf8");

      const l10nDir = path.join(tmpDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });

      const arbContent = {
        "@@locale": "en",
        loginButton: "Log In",
        "@loginButton": {
          description: "Button label to submit credentials",
        },
      };
      await fs.writeFile(path.join(l10nDir, "app_en.arb"), JSON.stringify(arbContent, null, 2), "utf8");

      const result = await exportTranslations({
        projectPath: tmpDir,
        format: "xliff-1.2",
        targetLocales: ["de"],
      });

      expect(result.content).toBeDefined();
      expect(result.content).toContain("<note>Button label to submit credentials</note>");
      expect(result.content).toContain("<source>Log In</source>");
    });
  });

  describe("End-to-End Import Translations", () => {
    it("should import XLIFF translations into JSON catalogs with dryRun and write support", async () => {
      const pkg = { name: "test-app", dependencies: { "react-i18next": "^12.0.0" } };
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg), "utf8");

      const localesDir = path.join(tmpDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });

      const enCatalog = {
        greeting: "Hello",
      };
      const frCatalog = {
        greeting: "",
      };
      await fs.writeFile(path.join(localesDir, "en.json"), JSON.stringify(enCatalog, null, 2), "utf8");
      await fs.writeFile(path.join(localesDir, "fr.json"), JSON.stringify(frCatalog, null, 2), "utf8");

      const xliffContent = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="locales/en" source-language="en" target-language="fr" datatype="plaintext">
    <body>
      <trans-unit id="greeting">
        <source>Hello</source>
        <target state="translated">Bonjour</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

      // 1. Dry run
      const dryResult = await importTranslations({
        projectPath: tmpDir,
        content: xliffContent,
        dryRun: true,
      });

      expect(dryResult.unitsImported).toBe(1);
      expect(dryResult.diff).toBeDefined();
      expect(dryResult.diff).toContain("\"greeting\": \"Bonjour\"");

      // Verify file on disk is unchanged
      const frBefore = JSON.parse(await fs.readFile(path.join(localesDir, "fr.json"), "utf8"));
      expect(frBefore.greeting).toBe("");

      // 2. Write to disk
      const writeResult = await importTranslations({
        projectPath: tmpDir,
        content: xliffContent,
        dryRun: false,
      });

      expect(writeResult.unitsImported).toBe(1);
      const frAfter = JSON.parse(await fs.readFile(path.join(localesDir, "fr.json"), "utf8"));
      expect(frAfter.greeting).toBe("Bonjour");
    });

    it("should import TMX 1.4 translations into Flutter ARB files", async () => {
      const pubspec = `
name: flutter_app
dependencies:
  flutter:
    sdk: flutter
`;
      await fs.writeFile(path.join(tmpDir, "pubspec.yaml"), pubspec, "utf8");

      const l10nDir = path.join(tmpDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });

      const appEn = {
        "@@locale": "en",
        helloTitle: "Hello",
      };
      await fs.writeFile(path.join(l10nDir, "app_en.arb"), JSON.stringify(appEn, null, 2), "utf8");

      const tmxContent = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="i18n-mcp" srclang="en"/>
  <body>
    <tu tuid="helloTitle">
      <tuv xml:lang="en">
        <seg>Hello</seg>
      </tuv>
      <tuv xml:lang="es">
        <seg>Hola</seg>
      </tuv>
    </tu>
  </body>
</tmx>`;

      const result = await importTranslations({
        projectPath: tmpDir,
        content: tmxContent,
        targetLocales: ["es"],
        dryRun: false,
      });

      expect(result.unitsImported).toBe(1);
      const esArbPath = path.join(l10nDir, "app_es.arb");
      const esArb = JSON.parse(await fs.readFile(esArbPath, "utf8"));
      expect(esArb.helloTitle).toBe("Hola");
      expect(esArb["@@locale"]).toBe("es");
    });
  });
});
