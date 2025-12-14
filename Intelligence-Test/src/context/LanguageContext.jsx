import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { t as translate, getLanguage, setLanguage as setLang, getAvailableLanguages } from '../lib/i18n';

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(getLanguage());
  const [, forceUpdate] = useState(0);

  // Initialize language from localStorage
  useEffect(() => {
    const storedLang = getLanguage();
    if (storedLang !== language) {
      setLanguageState(storedLang);
    }
  }, []);

  // Set language and trigger re-render
  const setLanguage = useCallback((lang) => {
    if (setLang(lang)) {
      setLanguageState(lang);
      forceUpdate(n => n + 1); // Force re-render of all components
      return true;
    }
    return false;
  }, []);

  // Translation function that uses current language
  const t = useCallback((key, params = {}) => {
    return translate(key, params);
  }, [language]); // Re-create when language changes

  const value = {
    language,
    setLanguage,
    t,
    availableLanguages: getAvailableLanguages(),
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

// Hook for components that only need the translation function
export const useTranslation = () => {
  const { t, language } = useLanguage();
  return { t, language };
};
