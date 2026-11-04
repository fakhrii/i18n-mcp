export type DuplicateMatchType = "EXACT" | "FUZZY" | "CROSS_NAMESPACE";

export interface DuplicateMatch {
  id: string;
  matchType: DuplicateMatchType;
  similarity: number;
  keyA: string;
  namespaceA: string;
  valueA: string;
  fileA?: string;
  keyB: string;
  namespaceB: string;
  valueB: string;
  fileB?: string;
  canonicalRecommendation: string;
}

export interface DeduplicationCluster {
  canonicalKey: string;
  canonicalNamespace: string;
  value: string;
  keys: Array<{
    key: string;
    namespace: string;
    file?: string;
  }>;
  totalOccurrences: number;
}

export interface DeduplicationOptions {
  projectPath?: string;
  sourceLocale?: string;
  similarityThreshold?: number;
  exactOnly?: boolean;
  crossNamespaceOnly?: boolean;
  targetNamespace?: string;
  consolidate?: boolean;
  dryRun?: boolean;
  scope?: string[];
}

export interface DeduplicationResult {
  projectRoot: string;
  sourceLocale: string;
  totalKeysScanned: number;
  exactDuplicatesCount: number;
  fuzzyDuplicatesCount: number;
  crossNamespaceDuplicatesCount: number;
  clusters: DeduplicationCluster[];
  matches: DuplicateMatch[];
  keysConsolidated?: number;
  filesModified?: string[];
  diff?: string;
}
