// mobile/src/theme.ts
export const C = {
  bg:       '#09090c',
  s1:       '#111116',
  s2:       '#18181f',
  b1:       '#1f1f28',
  b2:       '#2a2a36',

  w:        '#ece8f8',
  w2:       'rgba(236,232,248,0.52)',
  w3:       'rgba(236,232,248,0.28)',
  w4:       'rgba(236,232,248,0.14)',

  emerald:  '#34d399',
  emeraldBg:'rgba(52,211,153,0.10)',
  emeraldBd:'rgba(52,211,153,0.18)',

  rose:     '#f0a8a8',
  roseBg:   'rgba(240,168,168,0.08)',
  roseBd:   'rgba(240,168,168,0.18)',

  sky:      '#96cfe8',
  amber:    '#e8c87a',
} as const;

export const T = {
  balanceHero:  { fontSize: 50, fontWeight: '800' as const, letterSpacing: -3, lineHeight: 48 },
  screenTitle:  { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.7 },
  sectionLabel: { fontSize: 8.5, fontWeight: '500' as const, letterSpacing: 1.1, textTransform: 'uppercase' as const },
  body:         { fontSize: 12, fontWeight: '400' as const },
  bodyMed:      { fontSize: 12, fontWeight: '500' as const },
  caption:      { fontSize: 10, fontWeight: '400' as const },
  micro:        { fontSize: 9, fontWeight: '400' as const },
  tabular:      { fontVariant: ['tabular-nums'] as const },
} as const;
