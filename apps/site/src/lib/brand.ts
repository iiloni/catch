import type { CSSProperties } from 'react';
import tokens from '../../../../branding/catch-brand-tokens.json';

const { amberLight, amberPrimary, amberDeep, cream, charcoal, landingShadow } = tokens.colors;

/** The brand palette as the custom properties `global.css` builds on. */
export const brandVariables = {
  '--brand-amber-light': amberLight.hex,
  '--brand-amber-primary': amberPrimary.hex,
  '--brand-amber-deep': amberDeep.hex,
  '--brand-cream': cream.hex,
  '--brand-charcoal': charcoal.hex,
  '--brand-shadow': landingShadow.hex,
} as CSSProperties;
