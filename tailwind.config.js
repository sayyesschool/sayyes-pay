/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#faf5ff",
          100: "#f3e8ff",
          500: "#7c3aed",
          600: "#6d28d9",
          900: "#4c1d95",
        },
      },
    },
  },
  plugins: [],
};
