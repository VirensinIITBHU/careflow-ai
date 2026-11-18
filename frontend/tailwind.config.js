/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        mute: 'rgb(var(--mute) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        brandsoft: 'rgb(var(--brandsoft) / <alpha-value>)',
        imm: 'rgb(var(--imm) / <alpha-value>)',
        immsoft: 'rgb(var(--immsoft) / <alpha-value>)',
        urg: 'rgb(var(--urg) / <alpha-value>)',
        urgsoft: 'rgb(var(--urgsoft) / <alpha-value>)',
        und: 'rgb(var(--und) / <alpha-value>)',
        undsoft: 'rgb(var(--undsoft) / <alpha-value>)',
        std: 'rgb(var(--std) / <alpha-value>)',
        stdsoft: 'rgb(var(--stdsoft) / <alpha-value>)',
        hl: 'rgb(var(--hl) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Noto Sans Devanagari', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.02)',
        pop: '0 12px 32px -12px rgb(0 0 0 / 0.25), 0 2px 6px rgb(0 0 0 / 0.06)',
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pulsering: { '0%': { boxShadow: '0 0 0 0 rgb(var(--imm) / 0.45)' }, '100%': { boxShadow: '0 0 0 14px rgb(var(--imm) / 0)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        flash: { '0%': { backgroundColor: 'rgb(var(--hl) / 0.9)' }, '100%': { backgroundColor: 'rgb(var(--hl) / 0.35)' } },
      },
      animation: {
        rise: 'rise .28s ease-out both',
        pulsering: 'pulsering 1.6s ease-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        flash: 'flash 1.2s ease-out both',
      },
    },
  },
  plugins: [],
}
