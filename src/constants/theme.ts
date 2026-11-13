/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#14202B',
    background: '#FFFFFF',
    backgroundElement: '#F3F5F8',
    backgroundSelected: '#E3E8ED',
    textSecondary: '#53616E',
    border: '#D3DAE1',
    accent: '#D9480F',
    accentText: '#FFFFFF',
    accentSoft: '#FCE6DA',
    positive: '#0D7068',
    positiveSoft: '#DBEFEC',
    danger: '#C2410C',
  },
  dark: {
    text: '#E5EBF0',
    background: '#0D1318',
    backgroundElement: '#1B252F',
    backgroundSelected: '#2A3643',
    textSecondary: '#9BA8B4',
    border: '#2A3643',
    accent: '#FF7A45',
    accentText: '#1A0D06',
    accentSoft: '#3B2318',
    positive: '#4CC0B5',
    positiveSoft: '#123230',
    danger: '#FF8F66',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
