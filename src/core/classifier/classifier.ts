import type {
  AstContextType,
  ConfidenceLevel,
  TextClassification,
} from "../../models/scanner.js";

export interface ClassificationResult {
  classification: TextClassification;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
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

// Regex patterns for technical values
const URL_REGEX = /^(?:https?|ftp|mailto|tel|ws|wss):\/\/[^\s/$.?#].[^\s]*$/i;
const FILE_PATH_REGEX = /^(?:\/|[a-zA-Z]:|\.{1,2}\/)[^<>:"|?*]+$/;
const FILE_EXT_REGEX = /\.(png|jpe?g|gif|svg|webp|json|ttf|otf|woff2?|css|html|md)$/i;
const COLOR_HEX_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FUNC_REGEX = /^(?:rgba?|hsla?)\([^)]+\)$/i;
const HTTP_METHOD_REGEX = /^(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)$/i;
const PURE_SYMBOLS_REGEX = /^[\s\d\-=_+!@#$%^&*()[\]{};':",.<>/?\\|`~]*$/;

export const TECHNICAL_UNITS_AND_SEPARATORS = new Set([
  "x",
  "v",
  "px",
  "rem",
  "em",
  "pt",
  "dp",
  "sp",
  "deg",
  "rad",
  "turn",
  "vh",
  "vw",
  "vmin",
  "vmax",
  "ms",
  "s",
  "sec",
  "secs",
  "min",
  "mins",
  "hr",
  "hrs",
  "kb",
  "mb",
  "gb",
  "tb",
  "fps",
  "dpi",
]);

export function isOnlyVariablesAndPunctuation(text: string): boolean {
  // Check if string contains variable placeholders {{...}} or ${...}
  const hasVariables = /\{\{[^}]+\}\}/.test(text) || /\$\{[^}]+\}/.test(text);
  if (!hasVariables) {
    return false;
  }

  // Strip all {{var}} placeholders and ${var} placeholders
  const stripped = text
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .trim();

  // If nothing remains, it was composed solely of variables and whitespace
  if (!stripped) {
    return true;
  }

  // If no letters remain (only punctuation, digits, symbols)
  if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(stripped)) {
    return true;
  }

  // Extract remaining words separated by punctuation, symbols, whitespace, and digits
  const remainingWords = stripped
    .split(/[\s\d\-=_+!@#$%^&*()[\]{};':",.<>/?\\|`~–—•·“”‘’…°€£¥₹₽₩×÷±≠≤≥→←↑↓]+/)
    .filter(Boolean);

  // If no words remain, it was only variables and punctuation
  if (remainingWords.length === 0) {
    return true;
  }

  // If all remaining words are technical units or single-letter separators (like 'x', 'v', 'px')
  if (remainingWords.every((w) => TECHNICAL_UNITS_AND_SEPARATORS.has(w.toLowerCase()))) {
    return true;
  }

  return false;
}

export function isScreamingSnakeCase(text: string): boolean {
  const trimmed = text.trim();
  // Must not contain any whitespace
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  // Must contain at least one underscore
  if (!trimmed.includes("_")) {
    return false;
  }
  // Must be composed only of uppercase letters, numbers, and underscores
  // and must contain at least one uppercase letter
  return /^_?[A-Z0-9]+(?:_[A-Z0-9]+)*_?$/.test(trimmed) && /[A-Z]/.test(trimmed);
}

export function isHierarchicalScreamingSnakeCase(text: string): boolean {
  const trimmed = text.trim();
  // Must not contain any whitespace
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  // Must contain a hierarchy delimiter (. / : ::)
  if (!/[./:]/.test(trimmed)) {
    return false;
  }
  // Exclude URLs
  if (URL_REGEX.test(trimmed)) {
    return false;
  }
  // Exclude file paths with file extensions (.png, .json, .ts, etc.)
  if (FILE_EXT_REGEX.test(trimmed)) {
    return false;
  }

  // Strip optional leading '@' (e.g. @app/AUTH_LOGIN)
  const cleaned = trimmed.replace(/^@/, "");

  // Split into segments by . / or :
  const segments = cleaned.split(/[:./]+/).filter(Boolean);
  if (segments.length < 2) {
    return false;
  }

  // Check if at least one segment is SCREAMING_SNAKE_CASE (e.g. auth/LOGIN_SUCCESS, USER/FETCH_PROFILE, AUTH.LOGIN_SUCCESS)
  const hasScreamingSnakeSegment = segments.some((seg) => isScreamingSnakeCase(seg));
  if (hasScreamingSnakeSegment && segments.every((seg) => /^[a-zA-Z0-9_-]+$/.test(seg))) {
    return true;
  }

  // Check if dot-separated, colon-separated, or slash-separated uppercase identifiers (e.g. AUTH.LOGIN, AUTH:LOGIN, APP.CONFIG, MODULE::ACTION, USER/LOGIN)
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
  // Standard SVG path starts with M or m followed by coordinate
  if (!/^[mM]\s*[-+]?\d/i.test(trimmed)) {
    return false;
  }
  // SVG path commands and coordinates: M, m, L, l, H, h, V, v, C, c, S, s, Q, q, T, t, A, a, Z, z, numbers, commas, spaces, dots, minuses
  const isAllSvgChars = /^[mMlLhHvVcCsSqQtTaAzZ0-9\s.,\-+]+$/.test(trimmed);
  return isAllSvgChars && trimmed.length > 5;
}

export const SVG_COMPONENTS = new Set([
  "Svg",
  "Path",
  "Circle",
  "Rect",
  "Polygon",
  "Polyline",
  "Line",
  "Ellipse",
  "G",
  "Defs",
  "ClipPath",
  "Mask",
  "Use",
  "Symbol",
  "LinearGradient",
  "RadialGradient",
  "Stop",
  "SvgXml",
  "SvgUri",
  "SvgCss",
  "SvgCssUri",
]);

export const TECHNICAL_PROP_NAMES = new Set([
  // SVG / Vector props
  "d",
  "viewBox",
  "points",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
  "strokeDasharray",
  "strokeDashoffset",
  "clipPath",
  "clipRule",
  "fillRule",
  "transform",
  "xmlns",
  "xlinkHref",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "x",
  "y",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",

  // Layout & Styling props
  "style",
  "color",
  "backgroundColor",
  "borderColor",
  "tintColor",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingHorizontal",
  "paddingVertical",
  "top",
  "bottom",
  "left",
  "right",
  "flex",
  "flexDirection",
  "flexWrap",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignItems",
  "alignSelf",
  "alignContent",
  "justifyContent",
  "position",
  "zIndex",
  "elevation",
  "opacity",
  "display",
  "overflow",
  "cursor",
  "pointerEvents",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "fontFamily",
  "fontStyle",
  "resizeMode",

  // Technical React / React Native props
  "testID",
  "accessibilityIdentifier",
  "nativeID",
  "key",
  "id",
  "ref",
  "source",
  "uri",
  "url",
  "href",
  "icon",
  "iconName",
  "vector",
  "keyboardType",
  "autoCapitalize",
  "autoComplete",
  "textContentType",
  "returnKeyType",
  "importantForAccessibility",
  "hitSlop",
  "contentContainerStyle",
]);

export const CSS_STYLE_PROPS = new Set([
  // Shadow & Elevation
  "boxshadow",
  "elevation",
  "shadowcolor",
  "shadowoffset",
  "shadowopacity",
  "shadowradius",
  "textshadowcolor",
  "textshadowoffset",
  "textshadowradius",

  // Text & Font styles
  "textalign",
  "textalignvertical",
  "color",
  "fontfamily",
  "fontsize",
  "fontstyle",
  "fontweight",
  "fontvariant",
  "letterspacing",
  "lineheight",
  "textdecorationcolor",
  "textdecorationline",
  "textdecorationstyle",
  "texttransform",
  "verticalalign",
  "writingdirection",
  "includefontpadding",

  // Layout & Flexbox
  "aligncontent",
  "alignitems",
  "alignself",
  "aspectratio",
  "bottom",
  "direction",
  "display",
  "end",
  "flex",
  "flexbasis",
  "flexdirection",
  "flexgrow",
  "flexshrink",
  "flexwrap",
  "gap",
  "rowgap",
  "columngap",
  "height",
  "justifycontent",
  "left",
  "margin",
  "marginbottom",
  "marginend",
  "marginhorizontal",
  "marginleft",
  "marginright",
  "marginstart",
  "margintop",
  "marginvertical",
  "maxheight",
  "maxwidth",
  "minheight",
  "minwidth",
  "overflow",
  "overflowx",
  "overflowy",
  "padding",
  "paddingbottom",
  "paddingend",
  "paddinghorizontal",
  "paddingleft",
  "paddingright",
  "paddingstart",
  "paddingtop",
  "paddingvertical",
  "position",
  "right",
  "start",
  "top",
  "width",
  "zindex",

  // View, Border & Background
  "backgroundcolor",
  "bordercolor",
  "borderstyle",
  "borderwidth",
  "borderbottomwidth",
  "borderleftwidth",
  "borderrightwidth",
  "bordertopwidth",
  "borderstartwidth",
  "borderendwidth",
  "borderradius",
  "borderbottomleftradius",
  "borderbottomrightradius",
  "borderbottomstartradius",
  "borderbottomendradius",
  "bordertopleftradius",
  "bordertoprightradius",
  "bordertopstartradius",
  "bordertopendradius",
  "borderstartstartradius",
  "borderstartendradius",
  "borderendstartradius",
  "borderendendradius",
  "bordercurve",
  "borderbottomcolor",
  "borderleftcolor",
  "borderrightcolor",
  "bordertopcolor",
  "borderstartcolor",
  "borderendcolor",
  "opacity",
  "backfacevisibility",

  // Image & Transforms
  "tintcolor",
  "overlaycolor",
  "resizemode",
  "transform",
  "transformorigin",
  "transformmatrix",
  "rotation",
  "scalex",
  "scaley",
  "translatex",
  "translatey",

  // Interaction & Web styles
  "cursor",
  "pointerevents",
  "userselect",
  "outline",
  "outlinecolor",
  "outlineoffset",
  "outlinewidth",
  "outlinestyle",
  "filter",
  "backdropfilter",
  "objectfit",
  "objectposition",
  "visibility",
  "whitespace",
  "wordbreak",

  // Style props
  "style",
]);

export function isCssStyleProp(propName: string): boolean {
  const normalized = propName.toLowerCase().replace(/[-_]/g, "");
  if (CSS_STYLE_PROPS.has(normalized)) {
    return true;
  }
  if (normalized.endsWith("style") || normalized.endsWith("styles")) {
    return true;
  }
  return false;
}

export function isBoxShadowValue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return false;
  }
  const parts = trimmed.split(/,\s*(?![^(]*\))/);
  if (parts.length === 0) {
    return false;
  }
  return parts.every((part) => {
    const p = part.trim();
    return /^(?:inset\s+)?[-+]?\d*\.?\d+(?:px|rem|em|%)?\s+[-+]?\d*\.?\d+(?:px|rem|em|%)?/i.test(p);
  });
}

export const CSS_DIMENSION_REGEX =
  /^[-+]?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|pt|dp|sp|deg|rad|turn)$/i;

export const CSS_KEYWORD_VALUES = new Set([
  // Box / layout
  "none",
  "auto",
  "hidden",
  "visible",
  "scroll",
  "inherit",
  "initial",
  "unset",
  // Flex
  "row",
  "column",
  "row-reverse",
  "column-reverse",
  "wrap",
  "nowrap",
  "wrap-reverse",
  "flex-start",
  "flex-end",
  "center",
  "space-between",
  "space-around",
  "space-evenly",
  "stretch",
  "baseline",
  // Position
  "absolute",
  "relative",
  "fixed",
  "static",
  "sticky",
  // Display
  "flex",
  "grid",
  "inline",
  "inline-flex",
  "inline-block",
  "block",
  "contents",
  // Text & Fonts
  "left",
  "right",
  "justify",
  "normal",
  "bold",
  "italic",
  "uppercase",
  "lowercase",
  "capitalize",
  "underline",
  "line-through",
  "underline line-through",
  "small-caps",
  // Border
  "solid",
  "dashed",
  "dotted",
  "double",
  // Image resize
  "cover",
  "contain",
  "repeat",
  // Pointer events
  "box-none",
  "box-only",
  // Colors
  "transparent",
  "currentcolor",
]);

export const TECHNICAL_CONFIG_PROPS = new Set([
  // Component size, status & variant props
  "size",
  "sizes",
  "fontsize",
  "iconsize",
  "status",
  "state",
  "position",
  "placement",
  "variant",
  "colorscheme",
  "mode",
  "type",
  "severity",
  "theme",
  "scheme",
  "align",
  "justify",
  "direction",
  "orientation",
  "animation",
  "animationtype",
  "transition",
  "duration",
  "delay",
  "offset",
  "interval",
  "timeout",
  "icon",
  "iconname",
  "action",
  "event",
  "target",
  "rel",
  "role",
  "accessibilityrole",
  "keyboardtype",
  "autocapitalize",
  "autocomplete",
  "textcontenttype",
  "returnkeytype",
  "resizemode",
  "importantforaccessibility",
  "badge",
  "priority",
  "format",
  "channel",
  "endpoint",
  "method",
]);

export function isTechnicalConfigProp(propName: string): boolean {
  const normalized = propName.toLowerCase().replace(/[-_]/g, "");
  return TECHNICAL_CONFIG_PROPS.has(normalized);
}

export const TECHNICAL_ENUM_VALUES = new Set([
  // Size tokens
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "small",
  "medium",
  "large",
  "mini",
  "tiny",
  "huge",
  "compact",
  "regular",

  // Status / Severity / Theme / Intent tokens
  "success",
  "error",
  "warning",
  "info",
  "danger",
  "primary",
  "secondary",
  "tertiary",
  "accent",
  "muted",
  "default",
  "neutral",
  "caution",
  "notice",
  "active",
  "inactive",
  "pending",
  "loading",
  "idle",
  "disabled",
  "resolved",
  "rejected",
  "light",
  "dark",
  "system",
  "auto",

  // Position / Placement tokens
  "top",
  "bottom",
  "left",
  "right",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
  "top-start",
  "top-end",
  "bottom-start",
  "bottom-end",
  "start",
  "end",
  "horizontal",
  "vertical",
  "ltr",
  "rtl",

  // Variant / Mode tokens
  "solid",
  "outline",
  "outlined",
  "ghost",
  "subtle",
  "link",
  "flat",
  "contained",
  "elevated",
  "standard",
  "filled",
  "clear",
  "round",
  "rounded",
  "pill",
  "square",
  "circle",
]);

export function isTechnicalEnumValue(text: string): boolean {
  return TECHNICAL_ENUM_VALUES.has(text.trim().toLowerCase());
}

const DATE_UNITS = new Set([
  "year", "years", "y",
  "month", "months", "m",
  "week", "weeks", "w",
  "day", "days", "d",
  "hour", "hours", "h",
  "minute", "minutes", "min", "mins",
  "second", "seconds", "s", "sec", "secs",
  "millisecond", "milliseconds", "ms",
  "quarter", "quarters", "q",
]);

export function isDateFormatOrUnit(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (DATE_UNITS.has(lower)) {
    return true;
  }

  // Check if string is composed of date format tokens (YYYY, MM, DD, etc.)
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
  // Date formatters & manipulators
  "format",
  "parse",
  "startof",
  "endof",
  "add",
  "subtract",
  "diff",
  "utc",
  "tz",
  "dayjs",
  "moment",
  "formatdistance",
  "formatrelative",
  "formatiso",

  // String / Array built-ins
  "split",
  "join",
  "replace",
  "replaceall",
  "includes",
  "indexof",
  "lastindexof",
  "startswith",
  "endswith",
  "slice",
  "substr",
  "substring",
  "match",
  "search",
  "padstart",
  "padend",
  "charat",
  "charcodeat",
  "concat",
  "repeat",
  "trim",
  "trimstart",
  "trimend",

  // Storage
  "getitem",
  "setitem",
  "removeitem",
  "multiget",
  "multiset",
  "clear",

  // Navigation routes
  "navigate",
  "push",
  "replace",
  "reset",
  "goback",
  "pop",
  "jumpto",

  // Events & Listeners
  "addeventlistener",
  "removeeventlistener",
  "addlistener",
  "removelistener",
  "emit",
  "on",
  "off",
  "once",

  // Timers & Async
  "settimeout",
  "setinterval",
  "cleartimeout",
  "clearinterval",

  // JSON & Parsing
  "stringify",
  "parseint",
  "parsefloat",
  "encodeuricomponent",
  "decodeuricomponent",
]);

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
}

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
  } = params;

  const trimmed = text.trim();

  // 1. Check for empty or purely symbols / punctuation
  if (!trimmed || PURE_SYMBOLS_REGEX.test(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "Empty text or punctuation/symbols only",
      isUserFacing: false,
    };
  }

  // 1b. Check for strings composed only of variables, or only variables and punctuation
  if (isOnlyVariablesAndPunctuation(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "Composed only of variables and punctuation",
      isUserFacing: false,
    };
  }

  // 2. Check for URLs
  if (URL_REGEX.test(trimmed)) {
    return {
      classification: "URL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "URL web address",
      isUserFacing: false,
    };
  }

  // 3. Check for File paths and assets
  if (FILE_PATH_REGEX.test(trimmed) || FILE_EXT_REGEX.test(trimmed)) {
    return {
      classification: "PATH",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: "File path or asset reference",
      isUserFacing: false,
    };
  }

  // 4. Check for Colors
  if (COLOR_HEX_REGEX.test(trimmed) || COLOR_FUNC_REGEX.test(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "Color code or function",
      isUserFacing: false,
    };
  }

  // 4b. Check for SVG path data
  if (isSvgPathData(trimmed) || propName === "d") {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "SVG path data or vector coordinates",
      isUserFacing: false,
    };
  }

  // 4c. Check for Date/Time format masks or date manipulation units
  if (isDateFormatOrUnit(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "Date/time format mask or time unit",
      isUserFacing: false,
    };
  }

  // 4d. Check if inside style context (StyleSheet.create, style={{...}}, styles variable, etc.)
  if (isStyleContext) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "Inside style or StyleSheet context",
      isUserFacing: false,
    };
  }

  // 4e. Check for CSS / Style properties
  if (propName && isCssStyleProp(propName)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: `CSS style property (${propName})`,
      isUserFacing: false,
    };
  }

  // 4f. Check for Box Shadow value
  if (isBoxShadowValue(trimmed)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "CSS box-shadow value",
      isUserFacing: false,
    };
  }

  // 4g. Check for CSS dimension or style keyword when in property or non-JSX-text context
  if (
    astType !== "JSX_TEXT" &&
    propName !== "title" &&
    propName !== "label" &&
    propName !== "placeholder" &&
    propName !== "description" &&
    propName !== "message" &&
    propName !== "error" &&
    (CSS_DIMENSION_REGEX.test(trimmed) || CSS_KEYWORD_VALUES.has(trimmed.toLowerCase()))
  ) {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: "CSS style keyword or dimension",
      isUserFacing: false,
    };
  }

  // 5. Check for HTTP methods
  if (HTTP_METHOD_REGEX.test(trimmed)) {
    return {
      classification: "API_FIELD",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: "HTTP method",
      isUserFacing: false,
    };
  }

  // 6. Check for Comparison / Switch expressions
  if (isComparison || isSwitchCase) {
    return {
      classification: "ENUM",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      reason: isComparison ? "Value used in binary comparison" : "Value in switch case",
      isUserFacing: false,
    };
  }

  // 7. Check for Logging calls
  if (
    calleeName &&
    (calleeName.startsWith("console.") ||
      calleeName.startsWith("logger.") ||
      calleeName === "log" ||
      calleeName === "warn" ||
      calleeName === "error")
  ) {
    return {
      classification: "LOG",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: `Log statement call (${calleeName})`,
      isUserFacing: false,
    };
  }

  // 8. Check for Analytics calls
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
      reason: `Analytics tracking call (${calleeName})`,
      isUserFacing: false,
    };
  }

  // 8b. Check for technical method calls (e.g. .format(), .split(), .navigate(), .getItem())
  if (calleeName) {
    const rawMethod = calleeName.split(".").pop()?.replace(/\(.*\)$/, "") || "";
    const methodLower = rawMethod.toLowerCase();
    if (TECHNICAL_CALLEE_METHODS.has(methodLower)) {
      return {
        classification: "TECHNICAL",
        confidence: 0.98,
        confidenceLevel: "HIGH",
        reason: `Argument to technical method (${calleeName})`,
        isUserFacing: false,
      };
    }
  }

  // 9. Check for Test IDs
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
      reason: `Test or element identifier attribute (${propName})`,
      isUserFacing: false,
    };
  }

  // 10. Check for known technical attributes
  if (propName && TECHNICAL_PROP_NAMES.has(propName)) {
    return {
      classification: "TECHNICAL",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: `Technical attribute prop (${propName})`,
      isUserFacing: false,
    };
  }

  // 10a. Check for technical configuration or enum props (size, status, position, placement, variant, etc.)
  if (propName && isTechnicalConfigProp(propName)) {
    return {
      classification: "ENUM",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: `Technical configuration/enum prop (${propName})`,
      isUserFacing: false,
    };
  }

  // 10b. Check for SVG components
  if (componentName && SVG_COMPONENTS.has(componentName) && astType !== "JSX_TEXT") {
    return {
      classification: "TECHNICAL",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: `SVG component attribute (<${componentName}>)`,
      isUserFacing: false,
    };
  }

  // 10c. Check for Vector Icon glyph name
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
      reason: `Icon or navigation screen identifier (${componentName} ${propName}="${trimmed}")`,
      isUserFacing: false,
    };
  }

  // 10d. Check for SCREAMING_SNAKE_CASE or Hierarchical SCREAMING_SNAKE_CASE
  if (isScreamingSnakeCase(trimmed) || isHierarchicalScreamingSnakeCase(trimmed)) {
    return {
      classification: "IDENTIFIER",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: isScreamingSnakeCase(trimmed)
        ? `SCREAMING_SNAKE_CASE identifier or constant (${trimmed})`
        : `Hierarchical SCREAMING_SNAKE_CASE identifier (${trimmed})`,
      isUserFacing: false,
    };
  }

  // 10e. Check for technical enum values (e.g. 'success', 'lg', 'sm', 'outline') in non-text contexts
  if (
    astType !== "JSX_TEXT" &&
    propName !== "title" &&
    propName !== "label" &&
    propName !== "placeholder" &&
    propName !== "description" &&
    propName !== "message" &&
    propName !== "error" &&
    isTechnicalEnumValue(trimmed)
  ) {
    return {
      classification: "ENUM",
      confidence: 0.99,
      confidenceLevel: "HIGH",
      reason: `Technical enum value (${trimmed})`,
      isUserFacing: false,
    };
  }

  // 11. User-Facing: JSX Text
  if (astType === "JSX_TEXT") {
    return {
      classification: "UI_TEXT",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: componentName
        ? `Text inside <${componentName}> JSX element`
        : "Text inside JSX element",
      isUserFacing: true,
    };
  }

  // 12. User-Facing: Accessibility Props
  if (
    propName &&
    (propName === "accessibilityLabel" || propName === "accessibilityHint")
  ) {
    return {
      classification: "ACCESSIBILITY",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: `Accessibility attribute (${propName})`,
      isUserFacing: true,
    };
  }

  // 13. User-Facing: Placeholder Props
  if (propName && (propName === "placeholder" || propName === "placeholderTextColor")) {
    if (propName === "placeholderTextColor") {
      return {
        classification: "TECHNICAL",
        confidence: 0.98,
        confidenceLevel: "HIGH",
        reason: "Placeholder color attribute",
        isUserFacing: false,
      };
    }
    return {
      classification: "PLACEHOLDER",
      confidence: 0.98,
      confidenceLevel: "HIGH",
      reason: `Input placeholder attribute (${propName})`,
      isUserFacing: true,
    };
  }

  // 14. User-Facing: Button Title Props
  if (
    propName &&
    (propName === "title" || propName === "label") &&
    (componentName === "Button" ||
      componentName === "TouchableOpacity" ||
      componentName === "CustomButton" ||
      componentName?.toLowerCase().includes("button"))
  ) {
    return {
      classification: "BUTTON",
      confidence: 0.97,
      confidenceLevel: "HIGH",
      reason: `Button title prop on <${componentName}>`,
      isUserFacing: true,
    };
  }

  // 15. User-Facing: Calls (Alert.alert, showToast, setError)
  if (calleeName) {
    if (calleeName === "Alert.alert" || calleeName === "alert") {
      if (astType === "OBJECT_PROPERTY") {
        if (
          propName === "title" ||
          propName === "message" ||
          propName === "description" ||
          propName === "text"
        ) {
          return {
            classification: "NOTIFICATION",
            confidence: 0.96,
            confidenceLevel: "HIGH",
            reason: `Alert dialog ${propName} (${calleeName})`,
            isUserFacing: true,
          };
        }
      } else {
        return {
          classification: "NOTIFICATION",
          confidence: 0.96,
          confidenceLevel: "HIGH",
          reason: `Alert notification dialog (${calleeName})`,
          isUserFacing: true,
        };
      }
    }
    if (
      calleeName.toLowerCase().includes("toast") ||
      calleeName.toLowerCase().includes("notify") ||
      calleeName.toLowerCase().includes("snackbar")
    ) {
      if (astType === "OBJECT_PROPERTY") {
        if (
          propName === "message" ||
          propName === "title" ||
          propName === "description" ||
          propName === "text" ||
          propName === "text1" ||
          propName === "text2" ||
          propName === "subtitle"
        ) {
          return {
            classification: "NOTIFICATION",
            confidence: 0.95,
            confidenceLevel: "HIGH",
            reason: `Toast notification ${propName} (${calleeName})`,
            isUserFacing: true,
          };
        }
      } else {
        return {
          classification: "NOTIFICATION",
          confidence: 0.95,
          confidenceLevel: "HIGH",
          reason: `Toast notification call (${calleeName})`,
          isUserFacing: true,
        };
      }
    }
    if (
      calleeName === "setError" ||
      calleeName === "setFieldError" ||
      calleeName.toLowerCase().includes("validationerror")
    ) {
      if (astType === "OBJECT_PROPERTY") {
        if (
          propName === "message" ||
          propName === "error" ||
          propName === "text" ||
          propName === "description"
        ) {
          return {
            classification: "VALIDATION_MESSAGE",
            confidence: 0.95,
            confidenceLevel: "HIGH",
            reason: `Validation error setter (${calleeName})`,
            isUserFacing: true,
          };
        }
      } else {
        return {
          classification: "VALIDATION_MESSAGE",
          confidence: 0.95,
          confidenceLevel: "HIGH",
          reason: `Validation error setter (${calleeName})`,
          isUserFacing: true,
        };
      }
    }
  }

  // 16. User-Facing: Title Props
  if (propName && (propName === "title" || propName === "headerTitle")) {
    return {
      classification: "TITLE",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      reason: `Title attribute prop (${propName})`,
      isUserFacing: true,
    };
  }

  // 17. User-Facing: Description / Subtitle / Message Props
  if (
    propName &&
    (propName === "description" ||
      propName === "subtitle" ||
      propName === "message" ||
      propName === "helperText")
  ) {
    return {
      classification: "DESCRIPTION",
      confidence: 0.95,
      confidenceLevel: "HIGH",
      reason: `Descriptive prop (${propName})`,
      isUserFacing: true,
    };
  }

  // 18. User-Facing: Error / Validation Props
  if (
    propName &&
    (propName === "error" ||
      propName === "errorMessage" ||
      propName === "errorText")
  ) {
    return {
      classification: "ERROR_MESSAGE",
      confidence: 0.96,
      confidenceLevel: "HIGH",
      reason: `Error message prop (${propName})`,
      isUserFacing: true,
    };
  }

  // 19. User-Facing: Object Properties
  if (astType === "OBJECT_PROPERTY" && propName) {
    if (propName === "title" || propName === "headerTitle") {
      return {
        classification: "TITLE",
        confidence: 0.93,
        confidenceLevel: "HIGH",
        reason: `Object title property (${propName})`,
        isUserFacing: true,
      };
    }
    if (propName === "label" || propName === "text") {
      return {
        classification: "LABEL",
        confidence: 0.92,
        confidenceLevel: "HIGH",
        reason: `Object label/text property (${propName})`,
        isUserFacing: true,
      };
    }
    if (propName === "description" || propName === "message") {
      return {
        classification: "DESCRIPTION",
        confidence: 0.92,
        confidenceLevel: "HIGH",
        reason: `Object description property (${propName})`,
        isUserFacing: true,
      };
    }
  }

  // 20. Template Literal in JSX or User-facing context
  if (astType === "TEMPLATE_LITERAL") {
    if (
      !trimmed.includes(" ") &&
      (trimmed.includes("_") || trimmed.includes("/") || trimmed.includes(":"))
    ) {
      return {
        classification: "IDENTIFIER",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        reason: "Template literal identifier or key",
        isUserFacing: false,
      };
    }

    return {
      classification: "USER_FACING",
      confidence: 0.92,
      confidenceLevel: "HIGH",
      reason: "Template literal in UI context",
      isUserFacing: true,
    };
  }

  // Fallback: Check if words are actual natural language alphabetic words
  const words = trimmed
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z]+[']?[a-zA-Z]*[.,!?:;]?$/.test(w));
  const hasMultipleWords = words.length >= 2;
  const startsWithCapital = /^[A-Z]/.test(trimmed);

  // If mostly numbers, coordinates, or symbols, don't classify as natural language
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const isHeavyDigits = digitCount / trimmed.length > 0.25;

  if (hasMultipleWords && startsWithCapital && !isHeavyDigits) {
    return {
      classification: "USER_FACING",
      confidence: 0.78,
      confidenceLevel: "MEDIUM",
      reason: "Natural language sentence or title in source code",
      isUserFacing: true,
    };
  }

  if (hasMultipleWords && !isHeavyDigits) {
    return {
      classification: "USER_FACING",
      confidence: 0.65,
      confidenceLevel: "MEDIUM",
      reason: "Multi-word string literal",
      isUserFacing: true,
    };
  }

  // Technical identifier / single word token
  return {
    classification: "TECHNICAL",
    confidence: 0.85,
    confidenceLevel: "HIGH",
    reason: "Single word token or code identifier",
    isUserFacing: false,
  };
}
