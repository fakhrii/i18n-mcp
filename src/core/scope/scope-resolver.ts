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
  "**/.dart_tool/**",
  "**/*.g.dart",
  "**/*.freezed.dart",
  "**/*.mocks.dart",
  "**/lib/generated/**",
  "**/l10n/generated/**",
  "**/.flutter-plugins*",
  "**/ios/Pods/**",
  "**/macos/Pods/**",
  "**/.gradle/**",
  "**/android/.gradle/**",
  // Flutter Non-UI Architecture Layers & Constants
  "**/constants/**",
  "**/constant/**",
  "**/*constant*.dart",
  "**/*_constants.dart",
  "**/lib/**/data/**",
  "**/lib/**/domain/**",
  "**/lib/**/constants/**",
  "**/lib/**/constant/**",
  "**/lib/**/models/**",
  "**/lib/**/remote_models/**",
  "**/lib/**/local_models/**",
  "**/lib/**/entities/**",
  "**/lib/**/datasources/**",
  "**/lib/**/data_sources/**",
  "**/lib/**/repositories/**",
  "**/lib/**/repository_impl/**",
  "**/lib/**/network/**",
  "**/lib/**/http/**",
  "**/lib/**/http_strategy_helper/**",
  "**/lib/**/services/**",
  "**/lib/**/storage/**",
  "**/lib/**/local_storage/**",
  "**/lib/**/preferences/**",
  "**/lib/**/database/**",
  "**/lib/**/di/**",
  "**/lib/**/injection/**",
  "**/lib/**/migration/**",
  "**/lib/**/migrations/**",
  "**/lib/**/interceptors/**",
  "**/lib/**/middleware/**",
  "**/lib/**/routes/**",
  "**/*_model.dart",
  "**/*_models.dart",
  "**/*_entity.dart",
  "**/*_entities.dart",
  "**/*_dto.dart",
  "**/*_dtos.dart",
  "**/*_datasource*.dart",
  "**/*_repository*.dart",
  "**/*_strategy.dart",
  "**/*_strategies.dart",
  "**/*_service.dart",
  "**/*_service_impl.dart",
  "**/*_interceptor*.dart",
  "**/*_migration*.dart",
  "**/*_endpoint*.dart",
  "**/*_route*.dart",
  "**/*_event*.dart",
  "**/*_state*.dart",
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
  "src/**/*.{ts,tsx,js,jsx,html,vue}",
  "app/**/*.{ts,tsx,js,jsx,html,vue}",
  "components/**/*.{ts,tsx,js,jsx,html,vue}",
  "screens/**/*.{ts,tsx,js,jsx,html,vue}",
  "features/**/*.{ts,tsx,js,jsx,html,vue}",
  "pages/**/*.{ts,tsx,js,jsx,html,vue}",
  "lib/**/*.{dart,ts,tsx,js,jsx,vue}",
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
        const pattern = `${relDir}/**/*.{ts,tsx,js,jsx,dart,html}`;
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

  // If common folders didn't match anything, fallback to searching all root ts/tsx/js/jsx/dart/html files
  if (matched.length === 0 && includes.length === 0) {
    matched = await fg("**/*.{ts,tsx,js,jsx,dart,html}", {
      cwd: posixRoot,
      ignore: excludes,
      dot: false,
    });
  }

  return matched.map(toPosixPath).sort();
}
