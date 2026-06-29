import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        // Deep-slate command-center sidebar (brand).
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          muted: 'hsl(var(--sidebar-muted) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
          accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
        },
        // WIZER brand palette — use as wizer-navy / wizer-blue / wizer-cyan etc.
        wizer: {
          navy: 'hsl(var(--wizer-navy) / <alpha-value>)',
          blue: 'hsl(var(--wizer-blue) / <alpha-value>)',
          cyan: 'hsl(var(--wizer-cyan) / <alpha-value>)',
          light: 'hsl(var(--wizer-light) / <alpha-value>)',
          gray: 'hsl(var(--wizer-gray) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // Display headings — Saira (en) / Tajawal (ar).
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
        // WIZER Latin wordmark — always Saira regardless of locale.
        wordmark: ['var(--font-saira)', 'var(--font-display)', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
