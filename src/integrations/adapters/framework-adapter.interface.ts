import type { FrameworkType, LanguageType } from "../../models/project.js";

export interface FrameworkAdapter {
  readonly id: FrameworkType;
  readonly displayName: string;
  readonly defaultLanguage: LanguageType;
  readonly fileExtensions: string[];
  readonly defaultNamespaces: string[];

  /**
   * Checks if a component is a primary UI text rendering sink in this framework
   * (e.g. <Text> in React Native, <p>/<span>/<h1> in React/Next, Text() in Flutter).
   */
  isKnownTextComponent(componentName: string): boolean;

  /**
   * Checks if an attribute/prop is a designated user-facing text prop
   * (e.g. title, placeholder, label, helperText, accessibilityLabel, alt).
   */
  isKnownTextProp(propName: string): boolean;

  /**
   * Checks if a call expression is a designated user alert/feedback sink
   * (e.g. Alert.alert, toast, SnackBar, showDialog).
   */
  isKnownFeedbackCall(calleeName: string): boolean;

  /**
   * The default translation hook or accessor syntax (e.g. 'useTranslation', 'useTranslations', 'AppLocalizations.of(context)!').
   */
  getDefaultTranslationPattern(): {
    importStatement: string;
    hookOrAccessor: string;
    callSyntax: string;
  };
}
