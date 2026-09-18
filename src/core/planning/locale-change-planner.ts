import * as path from "node:path";
import type { TranslationTargetLocale } from "../../models/plan.js";
import { toPosixPath } from "../../utils/file-system.js";

export interface LocalePlanningContext {
  projectRoot: string;
  localeDirectory: string | null;
  sourceLocale: string;
  targetLocales: string[];
  isSubdirStructure: boolean; // true if locales/<locale>/<ns>.json, false if locales/<locale>.json
  existingTargetTranslations?: Map<string, Map<string, Map<string, string>>>; // locale -> ns -> key -> val
}

/**
 * Determines the file path for a given locale and namespace.
 */
export function getLocaleFilePath(
  localeDirectory: string | null,
  locale: string,
  namespace: string,
  isSubdirStructure = true
): string {
  if (!localeDirectory) {
    return isSubdirStructure
      ? toPosixPath(path.join("locales", locale, `${namespace}.json`))
      : toPosixPath(path.join("locales", `${locale}.json`));
  }

  return isSubdirStructure
    ? toPosixPath(path.join(localeDirectory, locale, `${namespace}.json`))
    : toPosixPath(path.join(localeDirectory, `${locale}.json`));
}

/**
 * Plans target locale actions for a translation entry.
 */
export function planTargetLocales(
  namespace: string,
  key: string,
  context: LocalePlanningContext
): TranslationTargetLocale[] {
  const targets: TranslationTargetLocale[] = [];

  for (const locale of context.targetLocales) {
    const filePath = getLocaleFilePath(
      context.localeDirectory,
      locale,
      namespace,
      context.isSubdirStructure
    );

    const existingVal = context.existingTargetTranslations
      ?.get(locale)
      ?.get(namespace)
      ?.get(key);

    if (existingVal !== undefined) {
      targets.push({
        locale,
        action: "EXISTING_TRANSLATION",
        value: existingVal,
        filePath,
      });
    } else {
      targets.push({
        locale,
        action: "CREATE_TRANSLATION",
        filePath,
      });
    }
  }

  return targets;
}
