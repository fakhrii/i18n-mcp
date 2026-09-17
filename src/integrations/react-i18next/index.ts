// react-i18next integration adapter
export interface ReactI18nextPattern {
  hookName: "useTranslation";
  translationFunctionName: "t";
  componentName: "Trans";
}

export const REACT_I18NEXT_DEFAULT: ReactI18nextPattern = {
  hookName: "useTranslation",
  translationFunctionName: "t",
  componentName: "Trans",
};
