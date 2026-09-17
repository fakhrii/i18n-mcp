declare module "react" {
  const content: any;
  export default content;
  export const useState: any;
  export const useEffect: any;
  export const useMemo: any;
  export const useCallback: any;
}

declare module "react-native" {
  export const View: any;
  export const Text: any;
  export const TextInput: any;
  export const TouchableOpacity: any;
  export const StyleSheet: any;
  export const Button: any;
  export const Alert: any;
}

declare module "react-i18next" {
  export function useTranslation(ns?: string): {
    t: (key: string, options?: any) => string;
    i18n: any;
  };
  export const initReactI18next: any;
  export const Trans: any;
}

declare module "i18next" {
  const i18n: any;
  export default i18n;
}
