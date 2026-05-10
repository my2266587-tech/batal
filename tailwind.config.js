/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#F6F7FB",
          subtle: "#F8FAFC",
        },
        sidebar: {
          DEFAULT: "#0F172A",
          hover: "#1E293B",
          border: "#1E293B",
        },
        accent: {
          50: "#FFF7ED",
          100: "#FFEDD5",
          200: "#FED7AA",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
        },
        ink: {
          900: "#0F172A",
          800: "#1E293B",
          700: "#334155",
          500: "#64748B",
          400: "#94A3B8",
        },
        line: "#E2E8F0",
      },
      fontFamily: {
        sans: ["Heebo", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.04), 0 1px 2px rgba(15,23,42,0.03)",
        soft: "0 4px 16px rgba(15,23,42,0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
