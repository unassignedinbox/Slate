/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        eagle: {
          beak: '#f59e0b',
          eye: '#fbbf24',
          featherDark: '#1c1917',
          featherWarm: '#292524',
          featherWhite: '#f8fafc',
          talon: '#0f172a'
        }
      }
    },
  },
  plugins: [],
}
