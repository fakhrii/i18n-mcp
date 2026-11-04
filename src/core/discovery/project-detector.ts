import * as path from "node:path";
import type { FrameworkType, LanguageType, PackageManagerType } from "../../models/project.js";
import { fileExists, readJsonFile, readTextFile, findFilesByGlob } from "../../utils/file-system.js";

export interface ProjectMetadata {
  framework: FrameworkType;
  language: LanguageType;
  packageManager: PackageManagerType;
  packageName?: string;
  packageVersion?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export async function detectProjectMetadata(projectRoot: string): Promise<ProjectMetadata> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = await readJsonFile<{
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(packageJsonPath);

  const dependencies = packageJson?.dependencies ?? {};
  const devDependencies = packageJson?.devDependencies ?? {};
  const allDeps = { ...devDependencies, ...dependencies };

  // 0. Check for Flutter (pubspec.yaml)
  const pubspecPath = path.join(projectRoot, "pubspec.yaml");
  const isFlutter = await fileExists(pubspecPath);
  if (isFlutter) {
    const pubspecContent = (await readTextFile(pubspecPath)) || "";
    const nameMatch = pubspecContent.match(/^name:\s*([a-zA-Z0-9_-]+)/m);
    const versionMatch = pubspecContent.match(/^version:\s*([^\r\n#]+)/m);
    const flutterDeps: Record<string, string> = { ...dependencies };
    if (pubspecContent.includes("flutter_localizations:")) {
      flutterDeps["flutter_localizations"] = "sdk: flutter";
    }
    if (pubspecContent.includes("intl:")) {
      flutterDeps["intl"] = "any";
    }

    return {
      framework: "flutter",
      language: "dart",
      packageManager: "pub",
      packageName: nameMatch?.[1] || packageJson?.name,
      packageVersion: versionMatch?.[1]?.trim() || packageJson?.version,
      dependencies: flutterDeps,
      devDependencies,
    };
  }

  // 1. Framework detection
  let framework: FrameworkType = "unknown";
  if (
    "react-native" in allDeps ||
    "expo" in allDeps ||
    Object.keys(allDeps).some((d) => d.startsWith("@react-native/"))
  ) {
    framework = "react-native";
  } else if ("next" in allDeps) {
    framework = "nextjs";
  } else if (
    "@angular/core" in allDeps ||
    "@angular/common" in allDeps ||
    "@angular/cli" in allDeps ||
    (await fileExists(path.join(projectRoot, "angular.json")))
  ) {
    framework = "angular";
  } else if (
    "vue" in allDeps ||
    "nuxt" in allDeps ||
    "@nuxt/kit" in allDeps ||
    (await fileExists(path.join(projectRoot, "nuxt.config.ts"))) ||
    (await fileExists(path.join(projectRoot, "nuxt.config.js")))
  ) {
    framework = "vue";
  } else if ("react" in allDeps || "react-dom" in allDeps) {
    framework = "react";
  }

  // 2. Language detection
  let language: LanguageType = "javascript";
  if (framework === "angular") {
    language = "typescript";
  } else {
    const hasTsConfig = await fileExists(path.join(projectRoot, "tsconfig.json"));
    const hasTsDep = "typescript" in allDeps || "@types/react" in allDeps || "@types/react-native" in allDeps;

    if (hasTsConfig || hasTsDep) {
      language = "typescript";
    } else {
      // Check for any .ts or .tsx files
      const tsFiles = await findFilesByGlob("**/*.{ts,tsx}", projectRoot, [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
      ]);
      if (tsFiles.length > 0) {
        language = "typescript";
      }
    }
  }

  // 3. Package manager detection
  let packageManager: PackageManagerType = "unknown";
  if (await fileExists(path.join(projectRoot, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (await fileExists(path.join(projectRoot, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (
    (await fileExists(path.join(projectRoot, "bun.lockb"))) ||
    (await fileExists(path.join(projectRoot, "bun.lock")))
  ) {
    packageManager = "bun";
  } else if (await fileExists(path.join(projectRoot, "package-lock.json"))) {
    packageManager = "npm";
  } else if (packageJson) {
    packageManager = "npm";
  }

  return {
    framework,
    language,
    packageManager,
    packageName: packageJson?.name,
    packageVersion: packageJson?.version,
    dependencies,
    devDependencies,
  };
}
