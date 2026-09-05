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
    },
  },
  plugins: [],
}

export default config
