import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import 'intl-pluralrules';

import tr from './locales/tr.json';
import en from './locales/en.json';

const deviceLang = Localization.getLocales()[0]?.languageCode ?? 'tr';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      tr: { translation: tr },
      en: { translation: en },
    },
    lng: deviceLang === 'en' ? 'en' : 'tr',
    fallbackLng: 'tr',
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: 'v4',
  });

export default i18n;
