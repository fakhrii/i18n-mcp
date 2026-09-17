import * as path from "node:path";
import type { FrameworkType, LanguageType, PackageManagerType } from "../../models/project.js";
import { fileExists, readJsonFile, findFilesByGlob } from "../../utils/file-system.js";

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

  // 1. Framework detection
  let framework: FrameworkType = "unknown";
  if (
    "react-native" in allDeps ||
    "expo" in allDeps ||
    Object.keys(allDeps).some((d) => d.startsWith("@react-native/"))
  ) {
    framework = "react-native";
  } else if ("react" in allDeps || "react-dom" in allDeps) {
    framework = "react";
  }

  // 2. Language detection
  let language: LanguageType = "javascript";
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
