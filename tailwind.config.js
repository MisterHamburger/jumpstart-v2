/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ['"Cabinet Grotesk"', 'sans-serif'],
        body: ['Satoshi', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        // Override cyan → brand teal (#20b2aa)
        cyan: {
          300: '#5cd4cc',
          400: '#3ac3ba',
          500: '#20b2aa',
          600: '#1a9690',
          700: '#147a76',
          900: '#0a3d3b',
        },
        // Override pink → brand magenta (#dd33a7)
        pink: {
          300: '#ec78c8',
          400: '#e555b7',
          500: '#dd33a7',
          600: '#c42d95',
          700: '#a12579',
          900: '#51133d',
        },
        // Background
        navy: '#0f101f',
        surface: '#1e293b',
      },
    },
  },
  plugins: [],
}
