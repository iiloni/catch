import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { useEffect } from 'react';
import { useResolvedTheme } from './theme';

/**
 * Status and navigation bar icons follow the app's theme rather than the OS theme,
 * which differ when the user picks one in Settings.
 */
export function useSystemBarsStyle() {
  const theme = useResolvedTheme();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void SystemBars.setStyle({
      style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  }, [theme]);
}
