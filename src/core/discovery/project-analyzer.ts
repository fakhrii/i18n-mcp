import * as path from "node:path";
import type { ProjectAnalysis } from "../../models/project.js";
import { I18nMcpError } from "../../models/errors.js";
import { loadProjectConfig } from "../../config/config-loader.js";
import { detectProjectMetadata } from "./project-detector.js";
import { detectI18n } from "./i18n-detector.js";
import { detectProjectStructure } from "./feature-detector.js";
import { dirExists, toPosixPath } from "../../utils/file-system.js";
import { getFrameworkAdapter } from "../../integrations/adapters/index.js";
import { logger } from "../../utils/logger.js";

export async function analyzeProject(targetPath?: string): Promise<ProjectAnalysis> {
  const projectRoot = path.resolve(targetPath || process.cwd());

  if (!(await dirExists(projectRoot))) {
    throw new I18nMcpError(
      `Target project path does not exist: ${projectRoot}`,
      "PROJECT_NOT_FOUND",
      { path: toPosixPath(projectRoot) }
    );
  }

  logger.info(`Analyzing project at ${projectRoot}`);

  // 1. Load optional configuration
  const config = await loadProjectConfig(projectRoot);

  // 2. Detect basic project metadata
  const metadata = await detectProjectMetadata(projectRoot);

  // 3. Detect i18n setup
  const allDeps = { ...metadata.devDependencies, ...metadata.dependencies };
  const i18nResult = await detectI18n(projectRoot, allDeps, config);

  // 4. Detect feature / project structure
  const structure = await detectProjectStructure(projectRoot);

  // 5. Detect framework and resolve adapter
  const framework = config?.framework ?? metadata.framework;
  const adapter = getFrameworkAdapter(framework);

  // 6. Compose namespaces
  // Priority: config namespaces, existing locale namespaces, feature names + defaultNamespaces
  const namespacesSet = new Set<string>(i18nResult.namespaces);

  if (i18nResult.structureType === "flat") {
    namespacesSet.clear();
    namespacesSet.add("common");
  } else {
    // If no namespaces were found in locale files, infer likely namespaces from detected features
    if (namespacesSet.size === 0) {
      for (const ns of adapter.defaultNamespaces) {
        namespacesSet.add(ns);
      }
      for (const feature of structure.features) {
        namespacesSet.add(feature);
      }
    } else if (!namespacesSet.has("common")) {
      namespacesSet.add("common");
    }
  }

  // 7. Assemble complete analysis
  const warnings = [...i18nResult.warnings];

  if (framework === "unknown") {
    warnings.push({
      code: "UNKNOWN_FRAMEWORK",
      message: "Could not detect React Native or React framework. Defaulting to generic analysis.",
      severity: "info",
    });
  }

  const analysis: ProjectAnalysis = {
    framework,
    language: metadata.language,
    packageManager: metadata.packageManager,
    i18n: i18nResult.i18n,
    namespaces: Array.from(namespacesSet).sort(),
    projectStructure: structure,
    accessPatterns: i18nResult.accessPatterns,
    warnings,
    structureType: i18nResult.structureType,
  };

  logger.info(
    `Analysis complete: framework=${analysis.framework} (${adapter.displayName}), i18nLibrary=${analysis.i18n.library}, namespaces=[${analysis.namespaces.join(", ")}]`
  );

  return analysis;
}
