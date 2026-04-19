import type { Config } from 'tailwindcss';

// Tokens mirror apps/web/.design/palette.json + typography.json.
// Refined Minimal direction — see .design/brief.md for rationale.

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FAFAF7',
        surface: '#F4F2EC',
        border: '#E5E3DD',
        muted: '#8B8884',
        secondary: '#6B6864',
        text: '#1A1A1A',
        primary: '#1A1A1A',
        accent: {
          DEFAULT: '#C2552B',
          soft: '#F4E5DC',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['var(--font-inter-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
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
      },
      boxShadow: {
        // Refined Minimal: only one allowed shadow, very subtle.
        subtle: '0 1px 2px rgba(0, 0, 0, 0.04)',
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
