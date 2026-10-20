import * as path from "node:path";
import type { I18nSetupFile, I18nSetupPlan } from "../../models/setup.js";
import type { ProjectAnalysis } from "../../models/project.js";
import { dirExists, fileExists, toPosixPath } from "../../utils/file-system.js";

const ENTRY_FILE_CANDIDATES = [
  "App.tsx",
  "App.jsx",
  "App.js",
  "src/App.tsx",
  "src/App.jsx",
  "src/App.js",
  "index.js",
  "index.ts",
  "index.tsx",
  "src/index.js",
  "src/index.ts",
  "src/index.tsx",
];

export interface PlanSetupOptions {
  sourceLocale?: string;
  targetLocales?: string[];
  namespace?: string;
}

/**
 * Plans the creation of foundational i18n infrastructure for projects that have no internationalization.
 */
export async function planI18nSetup(
  projectRoot: string,
  analysis: ProjectAnalysis,
  options?: PlanSetupOptions
): Promise<I18nSetupPlan> {
  const isTs = analysis.language === "typescript";
  const hasSrcDir = await dirExists(path.join(projectRoot, "src"));
  const sourceLocale = options?.sourceLocale || analysis.i18n.sourceLocale || "en";
  const targetLocales = options?.targetLocales || analysis.i18n.targetLocales || [];
  const defaultNS = options?.namespace || "common";

  // Framework-specific greenfield setups
  if (analysis.framework === "flutter") {
    const filesToCreate: I18nSetupFile[] = [
      {
        path: "l10n.yaml",
        content: `arb-dir: lib/l10n\ntemplate-arb-file: app_${sourceLocale}.arb\noutput-localization-file: app_localizations.dart\n`,
        type: "CONFIG",
      },
    ];

    const allLocales = Array.from(new Set([sourceLocale, ...targetLocales]));
    for (const loc of allLocales) {
      filesToCreate.push({
        path: `lib/l10n/app_${loc}.arb`,
        content: JSON.stringify({ "@@locale": loc }, null, 2) + "\n",
        type: "LOCALE_RESOURCE",
      });
    }

    return {
      needed: true,
      library: "flutter_localizations",
      configFile: "l10n.yaml",
      localeDirectory: "lib/l10n",
      filesToCreate,
      dependenciesToAdd: {
        "flutter_localizations": "sdk: flutter",
        "intl": "any",
      },
    };
  }

  if (analysis.framework === "nextjs") {
    const messagesDir = hasSrcDir ? "src/messages" : "messages";
    const configFile = hasSrcDir ? "src/i18n/request.ts" : "i18n/request.ts";
    const filesToCreate: I18nSetupFile[] = [
      {
        path: configFile,
        content: `import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  const locale = "${sourceLocale}";
  return {
    locale,
    messages: (await import("../${messagesDir.replace(/^src\//, "")}/\${locale}.json")).default,
  };
});
`,
        type: "CONFIG",
      },
    ];

    const allLocales = Array.from(new Set([sourceLocale, ...targetLocales]));
    for (const loc of allLocales) {
      filesToCreate.push({
        path: `${messagesDir}/${loc}.json`,
        content: "{\n}\n",
        type: "LOCALE_RESOURCE",
      });
    }

    return {
      needed: true,
      library: "next-intl",
      configFile,
      localeDirectory: messagesDir,
      filesToCreate,
      dependenciesToAdd: {
        "next-intl": "^3.26.0",
      },
    };
  }

  // 1. Determine config and locale directories
  const configFilePath = hasSrcDir
    ? isTs
      ? "src/i18n/index.ts"
      : "src/i18n/index.js"
    : isTs
    ? "i18n.ts"
    : "i18n.js";

  const localeDirectory = hasSrcDir ? "src/locales" : "locales";

  // 2. Find App entry point
  let entryFile: string | undefined;
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    if (await fileExists(path.join(projectRoot, candidate))) {
      entryFile = candidate;
      break;
    }
  }

  // 3. Determine entry import statement
  let entryImportStatement: string | undefined;
  if (entryFile) {
    if (configFilePath.startsWith("src/i18n/")) {
      entryImportStatement = entryFile.startsWith("src/")
        ? `import "./i18n";`
        : `import "./src/i18n";`;
    } else {
      entryImportStatement = `import "./i18n";`;
    }
  }

  const filesToCreate: I18nSetupFile[] = [];

  // 4. Generate config file content
  const allLocales = Array.from(new Set([sourceLocale, ...targetLocales]));
  const relLocaleDir = configFilePath.includes("/") ? "../locales" : "./locales";

  const importLines: string[] = [
    `import i18n from "i18next";`,
    `import { initReactI18next } from "react-i18next";`,
  ];

  for (const loc of allLocales) {
    const varName = `${defaultNS}_${loc.replace(/[^a-zA-Z0-9]/g, "_")}`;
    importLines.push(`import ${varName} from "${relLocaleDir}/${loc}/${defaultNS}.json";`);
  }

  const resourceEntries = allLocales
    .map((loc) => {
      const varName = `${defaultNS}_${loc.replace(/[^a-zA-Z0-9]/g, "_")}`;
      return `  "${loc}": {\n    ${defaultNS}: ${varName},\n  },`;
    })
    .join("\n");

  const configContent = isTs
    ? `${importLines.join("\n")}

export const defaultNS = "${defaultNS}";
export const resources = {
${resourceEntries}
} as const;

i18n.use(initReactI18next).init({
  compatibilityJSON: "v3",
  lng: "${sourceLocale}",
  fallbackLng: "${sourceLocale}",
  supportedLngs: [${allLocales.map((l) => `"${l}"`).join(", ")}],
  defaultNS,
  fallbackNS: defaultNS,
  resources,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
`
    : `${importLines.join("\n")}

export const defaultNS = "${defaultNS}";
export const resources = {
${resourceEntries}
};

i18n.use(initReactI18next).init({
  compatibilityJSON: "v3",
  lng: "${sourceLocale}",
  fallbackLng: "${sourceLocale}",
  supportedLngs: [${allLocales.map((l) => `"${l}"`).join(", ")}],
  defaultNS,
  fallbackNS: defaultNS,
  resources,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
`;

  filesToCreate.push({
    path: toPosixPath(configFilePath),
    content: configContent,
    type: "CONFIG",
  });

  // 5. Initial locale resource files
  for (const loc of allLocales) {
    const locPath = `${localeDirectory}/${loc}/${defaultNS}.json`;
    filesToCreate.push({
      path: toPosixPath(locPath),
      content: "{\n}\n",
      type: "LOCALE_RESOURCE",
    });
  }

  return {
    needed: true,
    library: "react-i18next",
    configFile: toPosixPath(configFilePath),
    localeDirectory: toPosixPath(localeDirectory),
    entryFile: entryFile ? toPosixPath(entryFile) : undefined,
    entryImportStatement,
    filesToCreate,
    dependenciesToAdd: {
      "i18next": "^23.16.8",
      "react-i18next": "^15.1.4",
    },
  };
}
