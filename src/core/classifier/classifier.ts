import type {
  AstContextType,
  ConfidenceLevel,
  SemanticRole,
  TextClassification,
} from "../../models/scanner.js";

export interface ClassificationResult {
  classification: TextClassification;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  semanticRole?: SemanticRole;
  reason: string;
  isUserFacing: boolean;
}

const USER_FACING_CLASSES = new Set<TextClassification>([
  "USER_FACING",
  "UI_TEXT",
  "BUTTON",
  "LABEL",
  "TITLE",
  "DESCRIPTION",
  "PLACEHOLDER",
  "ERROR_MESSAGE",
  "VALIDATION_MESSAGE",
  "NOTIFICATION",
  "ACCESSIBILITY",
]);

export function isUserFacingClassification(c: TextClassification): boolean {
  return USER_FACING_CLASSES.has(c);
}

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

export function computeSemanticRole(isUserFacing: boolean, confidence: number): SemanticRole {
  if (confidence >= 0.85) {
    return isUserFacing ? "CONFIRMED_UI" : "CONFIRMED_TECHNICAL";
  }
  return "AMBIGUOUS";
}

export function resolveSemanticRole(isUserFacing: boolean, confidence: number): SemanticRole {
  return computeSemanticRole(isUserFacing, confidence);
}

// ---------------------------------------------------------------------------
// 1. Syntactic Invariants & Universal Code Patterns (Regex & Morphological)
// ---------------------------------------------------------------------------
const URL_REGEX = /^(?:https?|ftp|mailto|tel|ws|wss):\/\/[^\s/$.?#].[^\s]*$/i;
const FILE_PATH_REGEX = /^(?:\/|[a-zA-Z]:|\.{1,2}\/)[^<>:"|?*]+$/;
const FILE_EXT_REGEX = /\.(png|jpe?g|gif|svg|webp|json|ttf|otf|woff2?|css|html|md)$/i;
const COLOR_HEX_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FUNC_REGEX = /^(?:rgba?|hsla?)\([^)]+\)$/i;
const HTTP_METHOD_REGEX = /^(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)$/i;
const PURE_SYMBOLS_REGEX = /^[\s\d\-=_+!@#$%^&*()[\]{};':",.<>/?\\|`~]*$/;
export const CSS_DIMENSION_REGEX =
  /^[-+]?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|pt|dp|sp|deg|rad|turn)$/i;

export const TECHNICAL_UNITS_AND_SEPARATORS = new Set([
  "m", "min", "mins", "minute", "minutes",
  "s", "sec", "secs", "second", "seconds",
  "ms", "millisecond", "milliseconds", "us", "ns",
  "h", "hr", "hrs", "hour", "hours",
  "d", "day", "days", "w", "wk", "wks", "week", "weeks",
  "mo", "month", "months", "y", "yr", "yrs", "year", "years",
  "x", "v", "w", "h", "k", "px", "rem", "em", "pt", "dp", "sp", "deg", "rad", "turn", "vh", "vw",
  "b", "kb", "mb", "gb", "tb", "bps", "kbps", "mbps", "gbps",
  "km", "cm", "mm", "mi", "ft", "in", "yd", "kg", "g", "mg", "oz", "lb", "lbs",
  "fps", "dpi", "ppi", "hz", "khz", "mhz", "ghz",
]);

export function isOnlyVariablesAndPunctuation(text: string): boolean {
  const hasVariables =
    /\{\{[^}]+\}\}/.test(text) ||
    /\$\{[^}]+\}/.test(text) ||
    /\$[a-zA-Z_][a-zA-Z0-9_]*/.test(text);

  if (!hasVariables) return false;

  const stripped = text
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, "")
    .replace(/\\u[0-9a-fA-F]{4}/gi, "")
    .replace(/\\x[0-9a-fA-F]{2}/gi, "")
    .replace(/\\[nrtfv0]/gi, "")
    .replace(/[\n\r\t•·\u2022\u25CF–—]/g, "")
    .trim();

  if (!stripped) return true;
  if (!/\p{L}/u.test(stripped)) return true;

  const remainingWords = stripped
    .split(/[\s\d\-=_+!@#$%^&*()[\]{};':",.<>/?\\|`~–—•·“”‘’…°€£¥₹₽₩×÷±≠≤≥→←↑↓]+/)
    .filter(Boolean);

  if (remainingWords.length === 0) return true;
  if (remainingWords.every((w) => TECHNICAL_UNITS_AND_SEPARATORS.has(w.toLowerCase()))) {
    return true;
  }
  return false;
}

export function isMaskOrPlaceholderPattern(text: string): boolean {
  const stripped = text
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, "")
    .replace(/\\u[0-9a-fA-F]{4}/gi, "")
    .replace(/\\x[0-9a-fA-F]{2}/gi, "")
    .replace(/\\[nrtfv0]/gi, "")
    .replace(/[\n\r\t•·\u2022\u25CF–—]/g, "")
    .trim();

  if (!stripped) return false;
  // Mask pattern e.g. XXXX-XXXX, ****-****, ••••, XXXX, etc.
  return (
    /^[\s\d\-=_+/:,.*•#Xx]+$/.test(stripped) &&
    !/[a-wYZ\u00C0-\u024F\u1E00-\u1EFF]/i.test(stripped.replace(/[Xx]/g, ""))
  );
}

// ---------------------------------------------------------------------------
// Mock Data & Placeholder Detection Patterns
// ---------------------------------------------------------------------------
const MOCK_VAR_PREFIX_REGEX =
  /^(?:mock|dummy|fake|sample|stub|test|fixture|_mock|_dummy|_fake)/i;
const MOCK_VAR_SUFFIX_REGEX =
  /(?:Mock|Dummy|Fake|Sample|Stub|Fixture|TestData|Mocks|Dummies)(?:Data|Items|List|Array|Users|Posts|Feed|Response|Config|State|Options)?$/i;
const MOCK_CONST_REGEX =
  /^(?:MOCK_|DUMMY_|SAMPLE_|FAKE_|STUB_|TEST_DATA_|FIXTURE_)/;

export function isMockVariableName(varName?: string): boolean {
  if (!varName) return false;
  return (
    MOCK_VAR_PREFIX_REGEX.test(varName) ||
    MOCK_VAR_SUFFIX_REGEX.test(varName) ||
    MOCK_CONST_REGEX.test(varName)
  );
}

const MOCK_DIR_REGEX =
  /(?:^|[\\/])(?:__mocks__|mocks|mock|mockData|mock-data|fixtures|__fixtures__|stubs|stories)(?:[\\/]|$)/i;
const MOCK_FILE_REGEX =
  /(?:\.mock|\.mocks|\.fixture|\.fixtures|\.story|\.stories|mockData|dummyData)\.[a-zA-Z0-9]+$/i;

export function isMockFilePath(filePath?: string): boolean {
  if (!filePath) return false;
  return MOCK_DIR_REGEX.test(filePath) || MOCK_FILE_REGEX.test(filePath);
}

const LOREM_IPSUM_REGEX =
  /^(?:lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing|sed\s+do\s+eiusmod)/i;
const PLACEHOLDER_NAME_REGEX =
  /^(?:(?:john|jane)\s+doe|foo\s+bar|baz\s+qux|test\s+user|sample\s+user|dummy\s+user)$/i;
const PLACEHOLDER_EMAIL_REGEX =
  /^[a-zA-Z0-9._%+-]+@(?:example|test|sample|dummy|foo|fake)\.(?:com|org|net|io)$/i;
const PLACEHOLDER_PHONE_REGEX =
  /^(?:\+?1[-.\s]?)?(?:\(?555\)?[-.\s]?\d{3}[-.\s]?\d{4}|555[-.\s]?\d{4}|123[-.\s]?456[-.\s]?7890)$/;
const PLACEHOLDER_GENERIC_TEXT =
  /^(?:sample|dummy|mock|test)\s+(?:title|text|data|item|description|content|message|label|card|post|comment|notification)$/i;

export function isPlaceholderOrMockText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    LOREM_IPSUM_REGEX.test(trimmed) ||
    PLACEHOLDER_NAME_REGEX.test(trimmed) ||
    PLACEHOLDER_EMAIL_REGEX.test(trimmed) ||
    PLACEHOLDER_PHONE_REGEX.test(trimmed) ||
    PLACEHOLDER_GENERIC_TEXT.test(trimmed)
  );
}

export function isScreamingSnakeCase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!trimmed.includes("_")) return false;
  return /^_?[A-Z0-9]+(?:_[A-Z0-9]+)*_?$/.test(trimmed) && /[A-Z]/.test(trimmed);
}

export function isHierarchicalScreamingSnakeCase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed) || !/[./:]/.test(trimmed)) return false;
  if (URL_REGEX.test(trimmed) || FILE_EXT_REGEX.test(trimmed)) return false;

  const cleaned = trimmed.replace(/^@/, "");
  const segments = cleaned.split(/[:./]+/).filter(Boolean);
  if (segments.length < 2) return false;

  if (segments.some((seg) => isScreamingSnakeCase(seg)) && segments.every((seg) => /^[a-zA-Z0-9_-]+$/.test(seg))) {
    return true;
  }

  const isAllUpperSegments = segments.every(
    (seg) => /^[A-Z0-9_]+$/.test(seg) && /[A-Z]/.test(seg)
  );
  if (
    isAllUpperSegments &&
    (trimmed.includes(".") ||
      trimmed.includes(":") ||
      (trimmed.includes("/") && segments.every((s) => s.length > 2)))
  ) {
    return true;
  }

  return false;
}

export function isSvgPathData(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[mM]\s*[-+]?\d/i.test(trimmed)) return false;
  return /^[mMlLhHvVcCsSqQtTaAzZ0-9\s.,\-+]+$/.test(trimmed) && trimmed.length > 5;
}

export const SVG_COMPONENTS = new Set([
  "Svg", "Path", "Circle", "Rect", "Polygon", "Polyline", "Line", "Ellipse",
  "G", "Defs", "ClipPath", "Mask", "Use", "Symbol", "LinearGradient", "RadialGradient",
  "Stop", "SvgXml", "SvgUri", "SvgCss", "SvgCssUri",
]);

export const TECHNICAL_PROP_NAMES = new Set([
  "d", "viewBox", "points", "fill", "stroke", "strokeWidth", "strokeLinecap",
  "strokeLinejoin", "strokeMiterlimit", "strokeDasharray", "strokeDashoffset",
  "clipPath", "clipRule", "fillRule", "transform", "xmlns", "xlinkHref",
  "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "x", "y",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "style", "color", "backgroundColor", "borderColor", "tintColor",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical", "padding", "paddingTop", "paddingBottom",
  "paddingLeft", "paddingRight", "paddingHorizontal", "paddingVertical",
  "top", "bottom", "left", "right", "flex", "flexDirection", "flexWrap",
  "flexGrow", "flexShrink", "flexBasis", "alignItems", "alignSelf", "alignContent",
  "justifyContent", "position", "zIndex", "elevation", "opacity", "display",
  "overflow", "cursor", "pointerEvents", "fontSize", "fontWeight", "lineHeight",
  "letterSpacing", "textAlign", "fontFamily", "fontStyle", "resizeMode",
  "testID", "accessibilityIdentifier", "nativeID", "key", "id", "ref", "source",
  "uri", "url", "href", "icon", "iconName", "vector", "keyboardType",
  "autoCapitalize", "autoComplete", "textContentType", "returnKeyType",
  "importantForAccessibility", "hitSlop", "contentContainerStyle",
]);

export const CSS_STYLE_PROPS = new Set([
  "boxshadow", "elevation", "shadowcolor", "shadowoffset", "shadowopacity", "shadowradius",
  "textshadowcolor", "textshadowoffset", "textshadowradius", "textalign", "textalignvertical",
  "color", "fontfamily", "fontsize", "fontstyle", "fontweight", "fontvariant",
  "letterspacing", "lineheight", "textdecorationcolor", "textdecorationline",
  "textdecorationstyle", "texttransform", "verticalalign", "writingdirection",
  "includefontpadding", "aligncontent", "alignitems", "alignself", "aspectratio",
  "bottom", "direction", "display", "end", "flex", "flexbasis", "flexdirection",
  "flexgrow", "flexshrink", "flexwrap", "gap", "rowgap", "columngap", "height",
  "justifycontent", "left", "margin", "marginbottom", "marginend", "marginhorizontal",
  "marginleft", "marginright", "marginstart", "margintop", "marginvertical",
  "maxheight", "maxwidth", "minheight", "minwidth", "overflow", "overflowx", "overflowy",
  "padding", "paddingbottom", "paddingend", "paddinghorizontal", "paddingleft",
  "paddingright", "paddingstart", "paddingtop", "paddingvertical", "position",
  "right", "start", "top", "width", "zindex", "backgroundcolor", "bordercolor",
  "borderstyle", "borderwidth", "borderbottomwidth", "borderleftwidth",
  "borderrightwidth", "bordertopwidth", "borderstartwidth", "borderendwidth",
  "borderradius", "borderbottomleftradius", "borderbottomrightradius",
  "borderbottomstartradius", "borderbottomendradius", "bordertopleftradius",
  "bordertoprightradius", "bordertopstartradius", "bordertopendradius",
  "borderstartstartradius", "borderstartendradius", "borderendstartradius",
  "borderendendradius", "bordercurve", "borderbottomcolor", "borderleftcolor",
  "borderrightcolor", "bordertopcolor", "borderstartcolor", "borderendcolor",
  "opacity", "backfacevisibility", "tintcolor", "overlaycolor", "resizemode",
  "transform", "transformorigin", "transformmatrix", "rotation", "scalex", "scaley",
  "translatex", "translatey", "cursor", "pointerevents", "userselect", "outline",
  "outlinecolor", "outlineoffset", "outlinewidth", "outlinestyle", "filter",
  "backdropfilter", "objectfit", "objectposition", "visibility", "whitespace",
  "wordbreak", "style",
]);

export function isCssStyleProp(propName: string): boolean {
  const normalized = propName.toLowerCase().replace(/[-_]/g, "");
  return CSS_STYLE_PROPS.has(normalized) || normalized.endsWith("style") || normalized.endsWith("styles");
}

export function isBoxShadowValue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return false;
  const parts = trimmed.split(/,\s*(?![^(]*\))/);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const p = part.trim();
    return /^(?:inset\s+)?[-+]?\d*\.?\d+(?:px|rem|em|%)?\s+[-+]?\d*\.?\d+(?:px|rem|em|%)?/i.test(p);
  });
}

export const CSS_KEYWORD_VALUES = new Set([
  "none", "auto", "hidden", "visible", "scroll", "inherit", "initial", "unset",
  "row", "column", "row-reverse", "column-reverse", "wrap", "nowrap", "wrap-reverse",
  "flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly",
  "stretch", "baseline", "absolute", "relative", "fixed", "static", "sticky",
  "flex", "grid", "inline", "inline-flex", "inline-block", "block", "contents",
  "left", "right", "justify", "normal", "bold", "italic", "uppercase", "lowercase",
  "capitalize", "underline", "line-through", "underline line-through", "small-caps",
  "solid", "dashed", "dotted", "double", "cover", "contain", "repeat",
  "box-none", "box-only", "transparent", "currentcolor",
]);

export const TECHNICAL_CONFIG_PROPS = new Set([
  "size", "sizes", "fontsize", "iconsize", "status", "state", "position", "placement",
  "variant", "colorscheme", "mode", "type", "severity", "theme", "scheme",
  "align", "justify", "direction", "orientation", "animation", "animationtype",
  "transition", "duration", "delay", "offset", "interval", "timeout", "icon",
  "iconname", "action", "event", "target", "rel", "role", "accessibilityrole",
  "keyboardtype", "autocapitalize", "autocomplete", "textcontenttype", "returnkeytype",
  "resizemode", "importantforaccessibility", "badge", "priority", "format",
  "channel", "endpoint", "method",
]);

export function isTechnicalConfigProp(propName: string): boolean {
  const normalized = propName.toLowerCase().replace(/[-_]/g, "");
  return TECHNICAL_CONFIG_PROPS.has(normalized);
}

export const TECHNICAL_ENUM_VALUES = new Set([
  "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl",
  "small", "medium", "large", "mini", "tiny", "huge", "compact", "regular",
  "success", "error", "warning", "info", "danger", "primary", "secondary",
  "tertiary", "accent", "muted", "default", "neutral", "caution", "notice",
  "active", "inactive", "pending", "loading", "idle", "disabled", "resolved",
  "rejected", "light", "dark", "system", "auto",
  "top", "bottom", "left", "right", "center", "top-left", "top-right",
  "bottom-left", "bottom-right", "top-center", "bottom-center", "top-start",
  "top-end", "bottom-start", "bottom-end", "start", "end", "horizontal",
  "vertical", "ltr", "rtl", "solid", "outline", "outlined", "ghost", "subtle",
  "link", "flat", "contained", "elevated", "standard", "filled", "clear",
  "round", "rounded", "pill", "square", "circle",
]);

export function isTechnicalEnumValue(text: string): boolean {
  return TECHNICAL_ENUM_VALUES.has(text.trim().toLowerCase());
}

const DATE_UNITS = new Set([
  "year", "years", "y", "month", "months", "m", "week", "weeks", "w",
  "day", "days", "d", "hour", "hours", "h", "minute", "minutes", "min", "mins",
  "second", "seconds", "s", "sec", "secs", "millisecond", "milliseconds", "ms",
  "quarter", "quarters", "q",
]);

export function isDateFormatOrUnit(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (DATE_UNITS.has(lower)) return true;

  if (
    /(?:YYYY|YY|MMMM|MMM|MM|DD|HH|hh|mm|ss)/.test(trimmed) &&
    !/[b-ce-gijklnopqrtuvw-z]/i.test(
      trimmed.replace(
        /YYYY|YY|MMMM|MMM|MM|M|DD|D|Do|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|ZZ|Z|AM|PM/gi,
        ""
      )
    )
  ) {
    return true;
  }
  return false;
}

export const TECHNICAL_CALLEE_METHODS = new Set([
  "format", "parse", "startof", "endof", "add", "subtract", "diff", "utc", "tz",
  "dayjs", "moment", "formatdistance", "formatrelative", "formatiso",
  "split", "join", "replace", "replaceall", "includes", "indexof", "lastindexof",
  "startswith", "endswith", "slice", "substr", "substring", "match", "search",
  "padstart", "padend", "charat", "charcodeat", "concat", "repeat", "trim",
  "trimstart", "trimend", "getitem", "setitem", "removeitem", "multiget", "multiset",
  "clear", "navigate", "push", "reset", "goback", "pop", "jumpto",
  "addeventlistener", "removeeventlistener", "addlistener", "removelistener", "emit",
  "on", "off", "once", "settimeout", "setinterval", "cleartimeout", "clearinterval",
  "stringify", "parseint", "parsefloat", "encodeuricomponent", "decodeuricomponent",
]);

// ---------------------------------------------------------------------------
// 2. Structural Text Sinks & UI Contracts (The Inverted Core)
// ---------------------------------------------------------------------------
export function isStandardTextSinkProp(propName?: string): boolean {
  if (!propName) return false;
  const lower = propName.toLowerCase();
  return (
    lower === "title" ||
    lower === "headertitle" ||
    lower === "label" ||
    lower === "placeholder" ||
    lower === "description" ||
    lower === "subtitle" ||
    lower === "message" ||
    lower === "helpertext" ||
    lower === "errormessage" ||
    lower === "errortext" ||
    lower === "error" ||
    lower === "accessibilitylabel" ||
    lower === "accessibilityhint" ||
    lower === "alt" ||
    lower === "prompt" ||
    lower === "text" ||
    lower.startsWith("aria-")
  );
}

export function isFeedbackCallee(calleeName?: string): boolean {
  if (!calleeName) return false;
  const lower = calleeName.toLowerCase();
  return (
    lower === "alert.alert" ||
    lower === "alert" ||
    lower.endsWith(".alert") ||
    lower.includes("toast") ||
    lower.includes("notify") ||
    lower.includes("snackbar") ||
    lower.includes("dialog") ||
    lower === "seterror" ||
    lower === "setfielderror" ||
    lower.includes("validationerror")
  );
}

export interface ClassifyParams {
  text: string;
  astType: AstContextType;
  propName?: string;
  componentName?: string;
  calleeName?: string;
  isComparison?: boolean;
  isSwitchCase?: boolean;
  isObjectKey?: boolean;
  isStyleContext?: boolean;
  variableName?: string;
  filePath?: string;
}

// ---------------------------------------------------------------------------
// 3. Automated Classification Engine
// ---------------------------------------------------------------------------
export function classifyString(params: ClassifyParams): ClassificationResult {
  const {
    text,
    astType,
    propName,
    componentName,
    calleeName,
    isComparison,
    isSwitchCase,
    isStyleContext,
    variableName,
    filePath,
  } = params;

  const trimmed = text.trim();
  const startsWithCapital = /^[A-Z]/.test(trimmed);

  // --- Step 1a: Mock Data & Test Fixture Invariants ---
  if (variableName && isMockVariableName(variableName)) {
    return {
      classification: "TEST_DATA",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Enclosing variable is a mock data structure (${variableName})`,
      isUserFacing: false,
    };
  }

  if (filePath && isMockFilePath(filePath)) {
    return {
      classification: "TEST_DATA",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `File path indicates mock/test fixture (${filePath})`,
      isUserFacing: false,
    };
  }

  if (isPlaceholderOrMockText(trimmed)) {
    return {
      classification: "TEST_DATA",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Placeholder or mock content pattern ("${trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed}")`,
      isUserFacing: false,
    };
  }

  // --- Step 1: Syntactic Invariants & Universal Non-Text Checks ---
  if (!trimmed || !/\p{L}/u.test(trimmed) || PURE_SYMBOLS_REGEX.test(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Empty text or punctuation/symbols only (no letters)",
      isUserFacing: false,
    };
  }

  if (isOnlyVariablesAndPunctuation(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Composed only of variables and punctuation",
      isUserFacing: false,
    };
  }

  if (isMaskOrPlaceholderPattern(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Mask or placeholder pattern (e.g. card/PAN masking)",
      isUserFacing: false,
    };
  }

  if (URL_REGEX.test(trimmed)) {
    return {
      classification: "URL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "URL web address",
      isUserFacing: false,
    };
  }

  if (FILE_PATH_REGEX.test(trimmed) || FILE_EXT_REGEX.test(trimmed)) {
    return {
      classification: "PATH",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "File path or asset reference",
      isUserFacing: false,
    };
  }

  if (COLOR_HEX_REGEX.test(trimmed) || COLOR_FUNC_REGEX.test(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Color code or function",
      isUserFacing: false,
    };
  }

  if (isSvgPathData(trimmed) || propName === "d") {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "SVG path data or vector coordinates",
      isUserFacing: false,
    };
  }

  if (isDateFormatOrUnit(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Date/time format mask or time unit",
      isUserFacing: false,
    };
  }

  // --- Step 2: Logging, Analytics & Technical Method Calls ---
  if (
    calleeName &&
    (calleeName.startsWith("console.") ||
      calleeName.startsWith("logger.") ||
      calleeName === "log" ||
      calleeName === "warn" ||
      calleeName === "error" ||
      calleeName === "debugPrint" ||
      calleeName === "print" ||
      calleeName.endsWith(".log") ||
      calleeName.startsWith("assert") ||
      calleeName.includes("Exception") ||
      (/^(?:new\s+)?[A-Z][a-zA-Z0-9_]*(?:Exception|Error)$/.test(calleeName)) ||
      calleeName.startsWith("throw"))
  ) {
    return {
      classification: "LOG",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Log statement call (${calleeName})`,
      isUserFacing: false,
    };
  }

  if (
    calleeName &&
    (calleeName.toLowerCase().includes("track") ||
      calleeName.toLowerCase().includes("analytics") ||
      calleeName === "logEvent")
  ) {
    return {
      classification: "ANALYTICS_EVENT",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Analytics tracking call (${calleeName})`,
      isUserFacing: false,
    };
  }

  if (calleeName) {
    const rawMethod = calleeName.split(".").pop()?.replace(/\(.*\)$/, "") || "";
    if (TECHNICAL_CALLEE_METHODS.has(rawMethod.toLowerCase())) {
      return {
        classification: "TECHNICAL",
        confidence: 0.98,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_TECHNICAL",
        reason: `Argument to technical method (${calleeName})`,
        isUserFacing: false,
      };
    }
  }

  // --- Step 3: Code Identifiers, Constants & Branching ---
  if (isComparison || isSwitchCase) {
    return {
      classification: "ENUM",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: isComparison ? "Value used in binary comparison" : "Value in switch case",
      isUserFacing: false,
    };
  }

  if (
    propName &&
    (propName === "testID" ||
      propName === "accessibilityIdentifier" ||
      propName === "data-testid")
  ) {
    return {
      classification: "IDENTIFIER",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Test or element identifier attribute (${propName})`,
      isUserFacing: false,
    };
  }

  if (isScreamingSnakeCase(trimmed) || isHierarchicalScreamingSnakeCase(trimmed)) {
    return {
      classification: "IDENTIFIER",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: isScreamingSnakeCase(trimmed)
        ? `SCREAMING_SNAKE_CASE identifier (${trimmed})`
        : `Hierarchical SCREAMING_SNAKE_CASE identifier (${trimmed})`,
      isUserFacing: false,
    };
  }

  // --- Step 4: Style Context & Technical Props ---
  if (isStyleContext) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "Inside style or StyleSheet context",
      isUserFacing: false,
    };
  }

  if (propName && isCssStyleProp(propName)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `CSS style property (${propName})`,
      isUserFacing: false,
    };
  }

  if (isBoxShadowValue(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "CSS box-shadow value",
      isUserFacing: false,
    };
  }

  if (
    astType !== "JSX_TEXT" &&
    !isStandardTextSinkProp(propName) &&
    (CSS_DIMENSION_REGEX.test(trimmed) || CSS_KEYWORD_VALUES.has(trimmed.toLowerCase()))
  ) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "CSS style keyword or dimension",
      isUserFacing: false,
    };
  }

  if (HTTP_METHOD_REGEX.test(trimmed)) {
    return {
      classification: "API_FIELD",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: "HTTP method",
      isUserFacing: false,
    };
  }

  if (componentName && SVG_COMPONENTS.has(componentName) && astType !== "JSX_TEXT") {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `SVG component attribute (<${componentName}>)`,
      isUserFacing: false,
    };
  }

  if (
    propName === "name" &&
    componentName &&
    (componentName.includes("Icon") ||
      componentName === "FontAwesome" ||
      componentName === "Ionicons" ||
      componentName === "MaterialIcons" ||
      componentName === "Feather" ||
      componentName === "Octicons" ||
      componentName === "Stack.Screen" ||
      componentName === "Tab.Screen")
  ) {
    return {
      classification: "IDENTIFIER",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Icon or navigation screen identifier (${componentName} ${propName}="${trimmed}")`,
      isUserFacing: false,
    };
  }

  // --- Step 5: Primary User-Facing Text Sinks (Pillar 1) ---
  if (astType === "JSX_TEXT") {
    return {
      classification: "UI_TEXT",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: componentName ? `Text inside <${componentName}> JSX element` : "Text inside JSX element",
      isUserFacing: true,
    };
  }

  if (propName === "accessibilityLabel" || propName === "accessibilityHint") {
    return {
      classification: "ACCESSIBILITY",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Accessibility attribute (${propName})`,
      isUserFacing: true,
    };
  }

  if (propName === "placeholder" || propName === "placeholderTextColor") {
    if (propName === "placeholderTextColor") {
      return {
        classification: "TECHNICAL",
        confidence: 0.98,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_TECHNICAL",
        reason: "Placeholder color attribute",
        isUserFacing: false,
      };
    }
    return {
      classification: "PLACEHOLDER",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Input placeholder attribute (${propName})`,
      isUserFacing: true,
    };
  }

  if (
    (propName === "title" || propName === "label") &&
    componentName &&
    (componentName === "Button" ||
      componentName === "TouchableOpacity" ||
      componentName === "CustomButton" ||
      componentName.toLowerCase().includes("button"))
  ) {
    return {
      classification: "BUTTON",
      confidence: 0.97,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Button title prop on <${componentName}>`,
      isUserFacing: true,
    };
  }

  if (calleeName && isFeedbackCallee(calleeName)) {
    const isValidation = calleeName.toLowerCase().includes("error");
    const classification = isValidation ? "VALIDATION_MESSAGE" : "NOTIFICATION";
    if (astType === "OBJECT_PROPERTY") {
      if (
        propName === "title" ||
        propName === "message" ||
        propName === "description" ||
        propName === "text" ||
        propName === "text1" ||
        propName === "text2" ||
        propName === "subtitle" ||
        propName === "error"
      ) {
        return {
          classification,
          confidence: 0.95,
          confidenceLevel: "HIGH",
          semanticRole: "CONFIRMED_UI",
          reason: `${classification} property (${propName}) in ${calleeName}`,
          isUserFacing: true,
        };
      }
    } else {
      return {
        classification,
        confidence: 0.95,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_UI",
        reason: `${classification} call (${calleeName})`,
        isUserFacing: true,
      };
    }
  }

  if (propName === "title" || propName === "headerTitle") {
    return {
      classification: "TITLE",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Title attribute prop (${propName})`,
      isUserFacing: true,
    };
  }

  if (propName === "description" || propName === "subtitle" || propName === "message" || propName === "helperText") {
    return {
      classification: "DESCRIPTION",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Descriptive prop (${propName})`,
      isUserFacing: true,
    };
  }

  if (propName === "error" || propName === "errorMessage" || propName === "errorText") {
    return {
      classification: "ERROR_MESSAGE",
      confidence: 0.96,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: `Error message prop (${propName})`,
      isUserFacing: true,
    };
  }

  if (astType === "OBJECT_PROPERTY" && propName) {
    if (propName === "title" || propName === "headerTitle") {
      return {
        classification: "TITLE",
        confidence: 0.93,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_UI",
        reason: `Object title property (${propName})`,
        isUserFacing: true,
      };
    }
    if (propName === "label" || propName === "text") {
      return {
        classification: "LABEL",
        confidence: 0.92,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_UI",
        reason: `Object label/text property (${propName})`,
        isUserFacing: true,
      };
    }
    if (propName === "description" || propName === "message") {
      return {
        classification: "DESCRIPTION",
        confidence: 0.92,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_UI",
        reason: `Object description property (${propName})`,
        isUserFacing: true,
      };
    }
  }

  // --- Step 6: Non-Sink Attributes & Objects (Inverted Default) ---
  if (propName && isTechnicalConfigProp(propName) && !startsWithCapital) {
    return {
      classification: "ENUM",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Technical configuration/enum prop (${propName})`,
      isUserFacing: false,
    };
  }

  if (propName && TECHNICAL_PROP_NAMES.has(propName)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Technical attribute prop (${propName})`,
      isUserFacing: false,
    };
  }

  if (!isStandardTextSinkProp(propName) && isTechnicalEnumValue(trimmed)) {
    return {
      classification: "ENUM",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_TECHNICAL",
      reason: `Technical enum value (${trimmed})`,
      isUserFacing: false,
    };
  }

  // --- Step 7: Template Literals & Fallbacks ---
  if (astType === "TEMPLATE_LITERAL") {
    if (!trimmed.includes(" ") && (trimmed.includes("_") || trimmed.includes("/") || trimmed.includes(":"))) {
      return {
        classification: "IDENTIFIER",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_TECHNICAL",
        reason: "Template literal identifier or key",
        isUserFacing: false,
      };
    }

    return {
      classification: "USER_FACING",
      confidence: 0.92,
      confidenceLevel: "HIGH",
      semanticRole: "CONFIRMED_UI",
      reason: "Template literal in UI context",
      isUserFacing: true,
    };
  }

  // Natural language morphology checks (Pillar 2)
  const words = trimmed
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z]+[']?[a-zA-Z]*[.,!?:;]?$/.test(w));
  const hasMultipleWords = words.length >= 2;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const isHeavyDigits = digitCount / trimmed.length > 0.25;

  if (hasMultipleWords && startsWithCapital && !isHeavyDigits) {
    return {
      classification: "USER_FACING",
      confidence: 0.78,
      confidenceLevel: "MEDIUM",
      semanticRole: "AMBIGUOUS",
      reason: "Natural language sentence or title in source code",
      isUserFacing: true,
    };
  }

  if (hasMultipleWords && !isHeavyDigits) {
    return {
      classification: "USER_FACING",
      confidence: 0.65,
      confidenceLevel: "MEDIUM",
      semanticRole: "AMBIGUOUS",
      reason: "Multi-word string literal",
      isUserFacing: true,
    };
  }

  // If single word is Title-cased (e.g. 'Save', 'Done', 'Cancel') in unconfirmed context
  if (
    words.length === 1 &&
    startsWithCapital &&
    !isHeavyDigits &&
    /^[A-Z][a-zA-Z0-9]*[']?[a-zA-Z0-9]*$/.test(trimmed)
  ) {
    return {
      classification: "USER_FACING",
      confidence: 0.65,
      confidenceLevel: "MEDIUM",
      semanticRole: "AMBIGUOUS",
      reason: `Title-cased single word in unconfirmed context (${trimmed})`,
      isUserFacing: true,
    };
  }

  // Non-sink lowercase or code token single word default
  return {
    classification: "TECHNICAL",
    confidence: 0.85,
    confidenceLevel: "HIGH",
    semanticRole: "CONFIRMED_TECHNICAL",
    reason: "Single word token or code identifier",
    isUserFacing: false,
  };
}
