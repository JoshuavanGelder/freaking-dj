import React, { createContext, useContext } from 'react';

export type Tab = 'dj' | 'regels' | 'geleerd' | 'instellingen';

export type Route = { name: 'tabs' } | { name: 'plan'; planId: string } | { name: 'now' };

export type Nav = {
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => void;
  home: () => void;
};

const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNav buiten NavProvider');
  return n;
}

export function NavProvider({ value, children }: { value: Nav; children: React.ReactNode }) {
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
