import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UiPrefs {
  fontScale: number;
  setFontScale: (scale: number) => void;
}

const Ctx = createContext<UiPrefs | undefined>(undefined);

export function UiPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [fontScale, setFontScaleState] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('@beam:font_scale');
        if (stored) setFontScaleState(parseFloat(stored) || 1);
      } catch {}
    })();
  }, []);

  const setFontScale = (scale: number) => {
    setFontScaleState(scale);
    AsyncStorage.setItem('@beam:font_scale', String(scale)).catch(() => {});
  };

  return <Ctx.Provider value={{ fontScale, setFontScale }}>{children}</Ctx.Provider>;
}

export function useUiPrefs(): UiPrefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('UiPreferencesProvider missing');
  return v;
}

