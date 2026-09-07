import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    './middleware.ts',
    './next.config.mjs',
  ],
  theme: {
    extend: {
      colors: {
        'prana-charcoal': '#0F172A',
        'prana-amber': '#D97706',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 1px rgba(15, 23, 42, 0.04)',
        'panel-md': '0 6px 16px -4px rgba(15, 23, 42, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.08)',
        'panel-lg': '0 20px 40px -12px rgba(15, 23, 42, 0.22), 0 4px 12px -4px rgba(15, 23, 42, 0.1)',
      },
      transitionTimingFunction: {
        snappy: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
}

export default config
