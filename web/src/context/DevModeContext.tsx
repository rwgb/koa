import { createContext, useContext, useEffect, useState } from 'react';

const LS_KEY = 'koa_dev_mode';

interface DevModeContextValue {
  devMode: boolean;
  toggleDevMode: () => void;
}

const DevModeContext = createContext<DevModeContextValue | null>(null);

export function DevModeProvider({ children }: { children: React.ReactNode }) {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored !== null) {
      setDevMode(stored === 'true');
    }
  }, []);

  function toggleDevMode() {
    setDevMode(prev => {
      const next = !prev;
      localStorage.setItem(LS_KEY, String(next));
      return next;
    });
  }

  return (
    <DevModeContext.Provider value={{ devMode, toggleDevMode }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode(): DevModeContextValue {
  const ctx = useContext(DevModeContext);
  if (!ctx) throw new Error('useDevMode must be used within a DevModeProvider');
  return ctx;
}
