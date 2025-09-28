/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
