// Stand-in for src/app/LanguageProvider in the isolated component harness (the real one persists to IndexedDB).
import {createContext, useContext} from 'react';
export const LocaleContext = createContext<'pt-BR' | 'en-US'>('pt-BR');
export const useLanguage = () => ({ locale: useContext(LocaleContext) });
