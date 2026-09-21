import * as path from "node:path";
import type { DetectedString, ScanOptions, ScanResult } from "../../models/scanner.js";
import { isUserFacingClassification } from "../classifier/classifier.js";
import { resolveProjectFiles } from "../scope/scope-resolver.js";
import { loadProjectConfig } from "../../config/config-loader.js";
import { detectProjectMetadata } from "../discovery/project-detector.js";
import { detectI18n } from "../discovery/i18n-detector.js";
import { scanSourceFileAst } from "./ast-scanner.js";
import { readTextFile, toPosixPath } from "../../utils/file-system.js";
import { logger } from "../../utils/logger.js";

export async function scanHardcodedTexts(
  targetPath?: string,
  options?: ScanOptions
): Promise<ScanResult> {
  const startTime = Date.now();
  const projectRoot = path.resolve(targetPath || options?.projectPath || process.cwd());

  logger.info(`Scanning hardcoded texts in ${projectRoot}`);

  // 1. Load config and project metadata
  const config = await loadProjectConfig(projectRoot);
  const metadata = await detectProjectMetadata(projectRoot);
  const allDeps = { ...metadata.devDependencies, ...metadata.dependencies };
  const i18nInfo = await detectI18n(projectRoot, allDeps, config);
  const knownNamespaces = i18nInfo.namespaces.length > 0 ? i18nInfo.namespaces : ["common"];

  // 2. Resolve files in scope
  const targetFiles = await resolveProjectFiles(projectRoot, options, config);
  logger.info(`Resolved ${targetFiles.length} files to scan in scope`);

  const items: DetectedString[] = [];
  let userFacingCount = 0;
  let technicalCount = 0;

  for (const relFile of targetFiles) {
    const absFile = path.join(projectRoot, relFile);
    const content = await readTextFile(absFile);
    if (!content) continue;

    const detected = scanSourceFileAst({
      filePath: toPosixPath(relFile),
      sourceCode: content,
      knownNamespaces,
      config,
      onlyUserFacing: options?.onlyUserFacing ?? true,
      minConfidence: options?.minConfidence ?? 0.0,
    });

    for (const item of detected) {
      items.push(item);
      if (isUserFacingClassification(item.classification)) {
        userFacingCount++;
      } else {
        technicalCount++;
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Scan complete: ${items.length} strings detected (${userFacingCount} user-facing, ${technicalCount} technical) in ${durationMs}ms`
  );

  return {
    total: items.length,
    userFacingCount,
    technicalCount,
    items,
    durationMs,
  };
}
