import * as path from "node:path";
import fg from "fast-glob";
import type { ScanOptions } from "../../models/scanner.js";
import type { I18nMcpConfig } from "../../models/config.js";
import { fileExists, dirExists, toPosixPath } from "../../utils/file-system.js";

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/mocks/**",
  "**/mock/**",
  "**/mockData/**",
  "**/mock-data/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/stubs/**",
  "**/stories/**",
  "**/*.mock.*",
  "**/*.mocks.*",
  "**/*.fixture.*",
  "**/*.fixtures.*",
  "**/*.stories.*",
  "**/*.story.*",
  "**/*.stub.*",
  "**/coverage/**",
  "**/*.d.ts",
];

export const DEFAULT_INCLUDES = [
  "src/**/*.{ts,tsx,js,jsx}",
  "app/**/*.{ts,tsx,js,jsx}",
  "components/**/*.{ts,tsx,js,jsx}",
  "screens/**/*.{ts,tsx,js,jsx}",
  "features/**/*.{ts,tsx,js,jsx}",
];

export async function resolveProjectFiles(
  projectRoot: string,
  options?: ScanOptions,
  config?: I18nMcpConfig | null
): Promise<string[]> {
  const resolvedRoot = path.resolve(projectRoot);
  const posixRoot = toPosixPath(resolvedRoot);

  // Combine excludes
  const excludes = Array.from(
    new Set([
      ...DEFAULT_EXCLUDES,
      ...(config?.exclude ?? []),
      ...(options?.exclude ?? []),
    ])
  );

  // Handle explicit scope
  const rawScope = options?.scope;
  if (rawScope) {
    const scopes = Array.isArray(rawScope) ? rawScope : [rawScope];
    const resolvedFiles = new Set<string>();

    for (const s of scopes) {
      const fullPath = path.isAbsolute(s) ? s : path.join(resolvedRoot, s);

      if (await fileExists(fullPath)) {
        // Single file target
        const rel = toPosixPath(path.relative(resolvedRoot, fullPath));
        resolvedFiles.add(rel);
        continue;
      }

      if (await dirExists(fullPath)) {
        // Directory target
        const relDir = toPosixPath(path.relative(resolvedRoot, fullPath));
        const pattern = `${relDir}/**/*.{ts,tsx,js,jsx}`;
        const matched = await fg(pattern, {
          cwd: posixRoot,
          ignore: excludes,
          dot: false,
        });
        for (const m of matched) {
          resolvedFiles.add(toPosixPath(m));
        }
        continue;
      }

      // Glob or pattern target
      const pattern = toPosixPath(s);
      const matched = await fg(pattern, {
        cwd: posixRoot,
        ignore: excludes,
        dot: false,
      });
      for (const m of matched) {
        resolvedFiles.add(toPosixPath(m));
      }
    }

    return Array.from(resolvedFiles).sort();
  }

  // Combine includes
  const includes = Array.from(
    new Set([
      ...(options?.include ?? []),
      ...(config?.include ?? []),
    ])
  );

  const patterns = includes.length > 0 ? includes : DEFAULT_INCLUDES;

  let matched = await fg(patterns, {
    cwd: posixRoot,
    ignore: excludes,
    dot: false,
  });

  // If common folders didn't match anything, fallback to searching all root ts/tsx/js/jsx files
  if (matched.length === 0 && includes.length === 0) {
    matched = await fg("**/*.{ts,tsx,js,jsx}", {
      cwd: posixRoot,
      ignore: excludes,
      dot: false,
    });
  }

  return matched.map(toPosixPath).sort();
}
