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
          DEFAULT: "#F7F8FA",
          subtle: "#F9FAFB",
        },
        sidebar: {
          DEFAULT: "#26364D",
          hover: "#31445F",
          border: "#33455E",
        },
        // Soft orange, used as a highlight colour only.
        accent: {
          50: "#FDF4EF",
          100: "#FBE6DA",
          200: "#F6CBB4",
          300: "#F2AE8C",
          400: "#EE8C5F",
          500: "#E96A32",
          600: "#E96A32",
          700: "#C4541F",
        },
        ink: {
          900: "#1C2536",
          800: "#28344A",
          700: "#3B475C",
          600: "#475266",
          500: "#566176",
          400: "#7F8A9C",
        },
        line: {
          DEFAULT: "#E7EAEF",
          soft: "#EFF1F4",
        },
        // Pastel status tags — soft backgrounds, dark text for easy reading.
        tag: {
          "success-bg": "#E7F5EE",
          "success-fg": "#1E6B47",
          "warning-bg": "#FCF1DE",
          "warning-fg": "#80530F",
          "danger-bg": "#FDECEE",
          "danger-fg": "#B42332",
          "info-bg": "#E8F1FA",
          "info-fg": "#245A8A",
          "neutral-bg": "#EFF1F5",
          "neutral-fg": "#475467",
        },
      },
      fontFamily: {
        sans: ["Heebo", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.03)",
        soft: "0 4px 14px rgba(16,24,40,0.05)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
