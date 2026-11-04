import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  DeduplicationCluster,
  DeduplicationOptions,
  DeduplicationResult,
  DuplicateMatch,
} from "../../models/deduplication.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { loadExistingTranslations } from "../planning/existing-key-resolver.js";
import {
  calculateStringSimilarity,
  normalizeForSimilarity,
} from "./similarity.js";
import {
  dirExists,
  fileExists,
  listFiles,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import {
  isArbFile,
  parseArb,
  serializeArb,
  setArbEntry,
} from "../locale/arb-handler.js";
import {
  deleteNestedValue,
  getNestedValue,
  setNestedValue,
} from "../../utils/nested-json.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { resolveProjectFiles } from "../scope/scope-resolver.js";
import { logger } from "../../utils/logger.js";

function detectIndentation(jsonString: string): string {
  const match = jsonString.match(/^[ \t]+(?=")/m);
  return match ? match[0] : "  ";
}

/**
 * Scans translation catalogs for exact duplicates, fuzzy near-duplicates, and cross-namespace redundancy,
 * with optional automated consolidation.
 */
export async function auditDuplicates(
  options: DeduplicationOptions = {}
): Promise<DeduplicationResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const threshold = options.similarityThreshold ?? 0.85;
  const exactOnly = options.exactOnly ?? false;
  const crossNamespaceOnly = options.crossNamespaceOnly ?? false;
  const targetNs = options.targetNamespace || "common";
  const consolidate = options.consolidate ?? false;
  const dryRun = options.dryRun ?? true;

  logger.info(
    `Running deduplication audit in ${projectRoot} (threshold=${threshold}, consolidate=${consolidate})`
  );

  const analysis = await analyzeProject(projectRoot);
  const localeDir = analysis.i18n.localeDirectory;
  if (!localeDir) {
    throw new Error("No locale directory found in project.");
  }

  const fullLocaleDir = path.join(projectRoot, localeDir);
  if (!(await dirExists(fullLocaleDir))) {
    throw new Error(`Locale directory does not exist: ${toPosixPath(localeDir)}`);
  }

  const sourceLocale = options.sourceLocale || analysis.i18n.sourceLocale || "en";
  const sourceExisting = await loadExistingTranslations(projectRoot, localeDir, sourceLocale);

  const totalKeysScanned = sourceExisting.items.length;

  // 1. Group exact duplicates by normalized value
  const exactGroups = new Map<string, typeof sourceExisting.items>();
  for (const item of sourceExisting.items) {
    const norm = normalizeForSimilarity(item.value);
    if (!norm) continue;

    if (!exactGroups.has(norm)) {
      exactGroups.set(norm, []);
    }
    exactGroups.get(norm)!.push(item);
  }

  const clusters: DeduplicationCluster[] = [];
  const matches: DuplicateMatch[] = [];
  let exactDuplicatesCount = 0;
  let crossNamespaceDuplicatesCount = 0;
  let fuzzyDuplicatesCount = 0;

  // Process exact duplicate clusters
  for (const [, items] of exactGroups.entries()) {
    if (items.length < 2) continue;

    // Pick canonical key: prefer key in targetNs, then shortest key
    const canonicalItem =
      items.find((i) => i.namespace === targetNs) ||
      [...items].sort((a, b) => a.key.length - b.key.length)[0]!;

    const isCrossNs = items.some((i) => i.namespace !== items[0]!.namespace);
    if (isCrossNs) {
      crossNamespaceDuplicatesCount += items.length - 1;
    } else {
      exactDuplicatesCount += items.length - 1;
    }

    if (crossNamespaceOnly && !isCrossNs) continue;

    clusters.push({
      canonicalKey: canonicalItem.key,
      canonicalNamespace: canonicalItem.namespace,
      value: canonicalItem.value,
      keys: items.map((i) => ({
        key: i.key,
        namespace: i.namespace,
        file: toPosixPath(path.relative(projectRoot, i.sourceFile)),
      })),
      totalOccurrences: items.length,
    });

    // Pairwise matches
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i]!;
        const itemB = items[j]!;
        const matchType = itemA.namespace !== itemB.namespace ? "CROSS_NAMESPACE" : "EXACT";

        matches.push({
          id: `${itemA.namespace}.${itemA.key}<->${itemB.namespace}.${itemB.key}`,
          matchType,
          similarity: 1.0,
          keyA: itemA.key,
          namespaceA: itemA.namespace,
          valueA: itemA.value,
          fileA: toPosixPath(path.relative(projectRoot, itemA.sourceFile)),
          keyB: itemB.key,
          namespaceB: itemB.namespace,
          valueB: itemB.value,
          fileB: toPosixPath(path.relative(projectRoot, itemB.sourceFile)),
          canonicalRecommendation:
            canonicalItem.namespace === "common"
              ? canonicalItem.key
              : `${canonicalItem.namespace}.${canonicalItem.key}`,
        });
      }
    }
  }

  // 2. Pairwise Fuzzy Matching across distinct normalized groups
  if (!exactOnly && !crossNamespaceOnly) {
    const distinctNorms = Array.from(exactGroups.keys());

    for (let i = 0; i < distinctNorms.length; i++) {
      for (let j = i + 1; j < distinctNorms.length; j++) {
        const normA = distinctNorms[i]!;
        const normB = distinctNorms[j]!;

        const itemsA = exactGroups.get(normA)!;
        const itemsB = exactGroups.get(normB)!;
        const sampleA = itemsA[0]!;
        const sampleB = itemsB[0]!;

        const sim = calculateStringSimilarity(sampleA.value, sampleB.value);
        if (sim >= threshold && sim < 1.0) {
          fuzzyDuplicatesCount++;

          const shorter = sampleA.key.length <= sampleB.key.length ? sampleA : sampleB;
          matches.push({
            id: `fuzzy:${sampleA.namespace}.${sampleA.key}<->${sampleB.namespace}.${sampleB.key}`,
            matchType: "FUZZY",
            similarity: Math.round(sim * 100) / 100,
            keyA: sampleA.key,
            namespaceA: sampleA.namespace,
            valueA: sampleA.value,
            fileA: toPosixPath(path.relative(projectRoot, sampleA.sourceFile)),
            keyB: sampleB.key,
            namespaceB: sampleB.namespace,
            valueB: sampleB.value,
            fileB: toPosixPath(path.relative(projectRoot, sampleB.sourceFile)),
            canonicalRecommendation:
              shorter.namespace === "common"
                ? shorter.key
                : `${shorter.namespace}.${shorter.key}`,
          });
        }
      }
    }
  }

  let keysConsolidated = 0;
  const filesModified: string[] = [];
  const diffParts: string[] = [];

  // 3. Automated Consolidation (if requested)
  if (consolidate && clusters.length > 0) {
    const allLocales = Array.from(
      new Set([sourceLocale, ...(analysis.i18n.targetLocales || [])])
    );

    const dirFiles = await listFiles(fullLocaleDir);
    const isFlutter = analysis.framework === "flutter" || dirFiles.some((f) => isArbFile(f));

    for (const cluster of clusters) {
      const canonicalKey = cluster.canonicalKey;
      const canonicalNs = cluster.canonicalNamespace;
      const redundantItems = cluster.keys.filter(
        (k) => !(k.key === canonicalKey && k.namespace === canonicalNs)
      );

      for (const loc of allLocales) {
        if (isFlutter) {
          // Flutter ARB consolidation
          const arbRel = toPosixPath(path.join(localeDir, `app_${loc}.arb`));
          const arbAbs = path.join(projectRoot, arbRel);
          if (!(await fileExists(arbAbs))) continue;

          const oldContent = (await readTextFile(arbAbs)) || "";
          const arb = parseArb(oldContent);

          let arbChanged = false;
          // Ensure canonical key has a value
          const canonicalVal = arb.entries.get(canonicalKey);
          for (const red of redundantItems) {
            const redVal = arb.entries.get(red.key);
            if (redVal && !canonicalVal) {
              setArbEntry(arb, canonicalKey, redVal);
              arbChanged = true;
            }
            if (arb.entries.has(red.key)) {
              arb.entries.delete(red.key);
              arb.keyMetadata.delete(red.key);
              arbChanged = true;
              keysConsolidated++;
            }
          }

          if (arbChanged) {
            const updatedContent = serializeArb(arb);
            const diff = generateUnifiedDiff(arbRel, oldContent, updatedContent);
            if (diff) diffParts.push(diff);
            filesModified.push(arbRel);

            if (!dryRun) {
              await fs.writeFile(arbAbs, updatedContent, "utf8");
            }
          }
        } else {
          // JSON catalogs consolidation
          const isSubdir = await dirExists(path.join(fullLocaleDir, loc));

          if (isSubdir) {
            // Target namespace file
            const canonicalRel = toPosixPath(path.join(localeDir, loc, `${canonicalNs}.json`));
            const canonicalAbs = path.join(projectRoot, canonicalRel);
            let canonicalJson: Record<string, unknown> = {};
            let canonicalOldContent = "{}";
            let indent = "  ";

            if (await fileExists(canonicalAbs)) {
              canonicalOldContent = (await readTextFile(canonicalAbs)) || "{}";
              indent = detectIndentation(canonicalOldContent);
              try {
                canonicalJson = JSON.parse(canonicalOldContent);
              } catch {
                canonicalJson = {};
              }
            }

            let canonicalModified = false;

            // Remove redundant keys from their namespace files
            for (const red of redundantItems) {
              const redRel = toPosixPath(path.join(localeDir, loc, `${red.namespace}.json`));
              const redAbs = path.join(projectRoot, redRel);
              if (!(await fileExists(redAbs))) continue;

              const redOldContent = (await readTextFile(redAbs)) || "{}";
              let redJson: Record<string, unknown> = {};
              try {
                redJson = JSON.parse(redOldContent);
              } catch {
                continue;
              }

              const redVal = getNestedValue(redJson, red.key);
              if (redVal !== undefined) {
                // Ensure canonical has value
                if (getNestedValue(canonicalJson, canonicalKey) === undefined) {
                  setNestedValue(canonicalJson, canonicalKey, redVal);
                  canonicalModified = true;
                }

                deleteNestedValue(redJson, red.key);
                keysConsolidated++;

                const redUpdated = JSON.stringify(redJson, null, indent) + "\n";
                const diff = generateUnifiedDiff(redRel, redOldContent, redUpdated);
                if (diff) diffParts.push(diff);
                filesModified.push(redRel);

                if (!dryRun) {
                  await fs.writeFile(redAbs, redUpdated, "utf8");
                }
              }
            }

            if (canonicalModified) {
              const canonicalUpdated = JSON.stringify(canonicalJson, null, indent) + "\n";
              const diff = generateUnifiedDiff(canonicalRel, canonicalOldContent, canonicalUpdated);
              if (diff) diffParts.push(diff);
              filesModified.push(canonicalRel);

              if (!dryRun) {
                await fs.writeFile(canonicalAbs, canonicalUpdated, "utf8");
              }
            }
          } else {
            // Single-file JSON: locales/{loc}.json
            const singleRel = toPosixPath(path.join(localeDir, `${loc}.json`));
            const singleAbs = path.join(projectRoot, singleRel);
            if (!(await fileExists(singleAbs))) continue;

            const oldContent = (await readTextFile(singleAbs)) || "{}";
            const indent = detectIndentation(oldContent);
            let singleJson: Record<string, unknown> = {};
            try {
              singleJson = JSON.parse(oldContent);
            } catch {
              continue;
            }

            let modified = false;
            for (const red of redundantItems) {
              const redVal = getNestedValue(singleJson, red.key);
              if (redVal !== undefined) {
                if (getNestedValue(singleJson, canonicalKey) === undefined) {
                  setNestedValue(singleJson, canonicalKey, redVal);
                }
                deleteNestedValue(singleJson, red.key);
                keysConsolidated++;
                modified = true;
              }
            }

            if (modified) {
              const updated = JSON.stringify(singleJson, null, indent) + "\n";
              const diff = generateUnifiedDiff(singleRel, oldContent, updated);
              if (diff) diffParts.push(diff);
              filesModified.push(singleRel);

              if (!dryRun) {
                await fs.writeFile(singleAbs, updated, "utf8");
              }
            }
          }
        }
      }

      // Update source code references if scope files provided
      const codeFiles = await resolveProjectFiles(projectRoot, {
        scope: options.scope,
      });

      for (const red of redundantItems) {
        const oldRefRegex = new RegExp(`(['"])${red.namespace}\\.${red.key}\\1`, "g");
        const newRef = `${canonicalNs}.${canonicalKey}`;

        for (const codeFile of codeFiles) {
          const absPath = path.isAbsolute(codeFile) ? codeFile : path.join(projectRoot, codeFile);
          const relPath = toPosixPath(path.relative(projectRoot, absPath));
          const codeContent = (await readTextFile(absPath)) || "";
          if (!codeContent.includes(`${red.namespace}.${red.key}`)) continue;

          const updatedCode = codeContent.replace(oldRefRegex, `$1${newRef}$1`);
          if (updatedCode !== codeContent) {
            const diff = generateUnifiedDiff(relPath, codeContent, updatedCode);
            if (diff) diffParts.push(diff);
            filesModified.push(relPath);

            if (!dryRun) {
              await fs.writeFile(absPath, updatedCode, "utf8");
            }
          }
        }
      }
    }
  }

  return {
    projectRoot,
    sourceLocale,
    totalKeysScanned,
    exactDuplicatesCount,
    fuzzyDuplicatesCount,
    crossNamespaceDuplicatesCount,
    clusters,
    matches,
    keysConsolidated: consolidate ? keysConsolidated : undefined,
    filesModified: filesModified.length > 0 ? Array.from(new Set(filesModified)) : undefined,
    diff: diffParts.length > 0 ? diffParts.join("\n\n") : undefined,
  };
}
