import type { Config } from 'tailwindcss';

// Tokens mirror apps/web/.design/palette.json + typography.json.
// Refined Minimal direction — see .design/brief.md for rationale.

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm cream system. Background = the page canvas; surface = card/
        // grouped-content fills that need to pop against the page. Both warmed
        // up from the original near-white "Refined Minimal" palette so the
        // whole site reads as one editorial cream-and-terra-cotta voice.
        background: '#FDF9F3',
        surface: '#F4ECDD',
        border: '#E8DFCB',
        muted: '#8B8884',
        secondary: '#6B6864',
        text: '#1A1A1A',
        primary: '#1A1A1A',
        accent: {
          DEFAULT: '#C2552B',
          soft: '#F4E5DC',
        },
        // Barbiecore three-tier color system for the dating vertical.
        // Tier 1 (shell): app chrome + primary nav. Tier 3 (profile): neutral card surfaces.
        // Tier 2 per-experience mood surfaces are themed at runtime via inline CSS vars
        // --exp-bg / --exp-accent / --exp-ink, consumed as bg-[var(--exp-bg)] etc. (no static token needed).
        // Warm-filmic base + hot-pink ACCENT (pink is energy, not wallpaper).
        // shell.pink is a soft tint for occasional washes only.
        shell: { base: '#FAF4EC', accent: '#E0218A', ink: '#3D0F2E', pink: '#FFE5F1' },
        profile: { base: '#FAFAF8', ink: '#141414', tag: '#E5E5E0' },
        // Feed swipe gesture tints: green = interested (right), dark red-black = pass (left).
        swipe: { nope: '#3A0410' },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['var(--font-inter-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs:   ['12px', { lineHeight: '1.5' }],
        sm:   ['14px', { lineHeight: '1.5' }],
        base: ['16px', { lineHeight: '1.5' }],
        lg:   ['18px', { lineHeight: '1.5' }],
        xl:   ['21px', { lineHeight: '1.4' }],
        '2xl': ['28px', { lineHeight: '1.2' }],
        '3xl': ['38px', { lineHeight: '1.15' }],
        '4xl': ['50px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        '5xl': ['67px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        '6xl': ['89px', { lineHeight: '1.0',  letterSpacing: '-0.02em' }],
      },
      maxWidth: {
        content: '1200px',
      },
      borderRadius: {
        DEFAULT: '8px',
        card: '8px',
        pill: '9999px',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        // Refined Minimal: only one allowed shadow, very subtle.
        subtle: '0 1px 2px rgba(0, 0, 0, 0.04)',
        // Warm terracotta-tinted soft shadow for elevated cards/modals.
        warm: '0 20px 48px -12px rgba(194, 85, 43, 0.18)',
        // Pink-tinted elevated shadow for Barbiecore dating cards.
        fun: '0 16px 40px -12px rgba(224, 33, 138, 0.25)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)', // ease-out
      },
    },
  },
  plugins: [],
};

export default config;
