import { useTranslation } from 'react-i18next';

export function useT() {
  const { t, i18n } = useTranslation();
  return {
    t,
    lang: i18n.language,
    setLang: (lng: 'tr' | 'en') => i18n.changeLanguage(lng),
  };
}
