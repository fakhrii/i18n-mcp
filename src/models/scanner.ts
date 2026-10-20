export type AstContextType =
  | "JSX_TEXT"
  | "JSX_ATTRIBUTE"
  | "CALL_EXPRESSION"
  | "OBJECT_PROPERTY"
  | "TEMPLATE_LITERAL"
  | "ARRAY_ELEMENT"
  | "STRING_LITERAL";

export type TextClassification =
  | "USER_FACING"
  | "UI_TEXT"
  | "BUTTON"
  | "LABEL"
  | "TITLE"
  | "DESCRIPTION"
  | "PLACEHOLDER"
  | "ERROR_MESSAGE"
  | "VALIDATION_MESSAGE"
  | "NOTIFICATION"
  | "ACCESSIBILITY"
  | "TECHNICAL"
  | "URL"
  | "PATH"
  | "IDENTIFIER"
  | "API_FIELD"
  | "ENUM"
  | "LOG"
  | "ANALYTICS_EVENT"
  | "TEST_DATA"
  | "UNKNOWN";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type SemanticRole = "CONFIRMED_UI" | "CONFIRMED_TECHNICAL" | "AMBIGUOUS";

export interface DetectedString {
  id?: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  text: string;
  rawText: string;
  type: AstContextType;
  classification: TextClassification;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  semanticRole?: SemanticRole;
  suggestedNamespace: string;
  suggestedKey: string;
  reason: string;
  componentName?: string;
  propName?: string;
  calleeName?: string;
  variables?: string[];
  variableExpressions?: Record<string, string>;
  isPlural?: boolean;
  pluralVariable?: string;
  pluralForm?: {
    zero?: string;
    one: string;
    other: string;
  };
  isRichText?: boolean;
  richTextComponents?: Record<string, string>;
}

export interface ScanOptions {
  projectPath?: string;
  scope?: string | string[];
  include?: string[];
  exclude?: string[];
  onlyUserFacing?: boolean;
  minConfidence?: number;
  ambiguousOnly?: boolean;
}

export interface ScanResult {
  total: number;
  userFacingCount: number;
  technicalCount: number;
  ambiguousCount?: number;
  ambiguousItems?: DetectedString[];
  items: DetectedString[];
  durationMs: number;
}
