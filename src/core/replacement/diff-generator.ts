/**
 * Generates a unified diff between originalContent and newContent.
 */
export function generateUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string
): string {
  if (originalContent === newContent) {
    return "";
  }

  const oldLines = originalContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);

  // Compute Longest Common Subsequence (LCS) matrix
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to create diff operations
  interface DiffOp {
    type: "keep" | "add" | "delete";
    line: string;
    oldIdx: number;
    newIdx: number;
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "keep", line: oldLines[i - 1]!, oldIdx: i, newIdx: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: "add", line: newLines[j - 1]!, oldIdx: i, newIdx: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      ops.push({ type: "delete", line: oldLines[i - 1]!, oldIdx: i, newIdx: j });
      i--;
    }
  }

  ops.reverse();

  // Group into hunks with context
  const contextLines = 3;
  const diffChunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Find ranges of changes with context
  let chunkOps: DiffOp[] = [];
  let lastChangeIndex = -1;

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!;
    if (op.type !== "keep") {
      lastChangeIndex = k;
      if (chunkOps.length === 0) {
        // Add preceding context
        const start = Math.max(0, k - contextLines);
        for (let c = start; c < k; c++) {
          chunkOps.push(ops[c]!);
        }
      }
      chunkOps.push(op);
    } else if (chunkOps.length > 0) {
      if (k - lastChangeIndex <= contextLines) {
        chunkOps.push(op);
      } else {
        // Flush hunk
        emitHunk(diffChunks, chunkOps);
        chunkOps = [];
      }
    }
  }

  if (chunkOps.length > 0) {
    emitHunk(diffChunks, chunkOps);
  }

  return diffChunks.join("\n");
}

function emitHunk(diffChunks: string[], hunkOps: { type: string; line: string }[]): void {
  let hasDiff = false;
  const lines: string[] = [];

  for (const op of hunkOps) {
    if (op.type === "add") {
      lines.push(`+ ${op.line}`);
      hasDiff = true;
    } else if (op.type === "delete") {
      lines.push(`- ${op.line}`);
      hasDiff = true;
    } else {
      lines.push(`  ${op.line}`);
    }
  }

  if (hasDiff) {
    diffChunks.push(`@@ ... @@`);
    diffChunks.push(...lines);
  }
}
