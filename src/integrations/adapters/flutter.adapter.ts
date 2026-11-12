import type { FrameworkAdapter } from "./framework-adapter.interface.js";
import type { FlutterI18nConfig } from "../../models/project.js";

export class FlutterAdapter implements FrameworkAdapter {
  readonly id = "flutter" as const;
  readonly displayName = "Flutter";
  readonly defaultLanguage = "dart" as const;
  readonly fileExtensions = [".dart"];
  readonly defaultNamespaces = ["intl_en", "app_en"];

  private readonly textComponents = new Set([
    "Text",
    "TextSpan",
    "SelectableText",
    "RichText",
    "Semantics",
  ]);

  private readonly textProps = new Set([
    "title",
    "label",
    "labelText",
    "hintText",
    "helperText",
    "errorText",
    "tooltip",
    "semanticsLabel",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    return this.textComponents.has(componentName);
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      lower.endsWith("text") ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("tooltip")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower.includes("snackbar") ||
      lower.includes("showdialog") ||
      lower.includes("alertdialog")
    );
  }

  getDefaultTranslationPattern(config?: FlutterI18nConfig) {
    if (config) {
      return {
        importStatement: config.importStatement,
        hookOrAccessor: config.accessor,
        callSyntax: config.className,
      };
    }
    return {
      importStatement: "import 'package:flutter_gen/gen_l10n/app_localizations.dart';",
      hookOrAccessor: "final l10n = AppLocalizations.of(context)!;",
      callSyntax: "l10n",
    };
  }
}
