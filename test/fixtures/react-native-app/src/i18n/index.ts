import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonEn from "../locales/en/common.json";
import authEn from "../locales/en/auth.json";
import profileEn from "../locales/en/profile.json";

import commonFr from "../locales/fr/common.json";
import authFr from "../locales/fr/auth.json";
import profileFr from "../locales/fr/profile.json";

export const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    profile: profileEn,
  },
  fr: {
    common: commonFr,
    auth: authFr,
    profile: profileFr,
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
