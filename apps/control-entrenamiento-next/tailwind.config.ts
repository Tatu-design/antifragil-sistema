import type { Config } from "tailwindcss";

// Los valores salen del diseño actual de la app Flask (webapp/static/style.css),
// no de una paleta inventada: el objetivo de esta fase es equivalencia visual.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fondo: "#F5F7F4",
        acento: "#1FA99A",
        "acento-oscuro": "#188478",
        tinta: "#1A2420",
        "tinta-suave": "#5C6B65",
        borde: "#E2E8E4",
        aviso: "#C2410C",
      },
      borderRadius: { tarjeta: "16px" },
      maxWidth: { app: "430px" },
    },
  },
  plugins: [],
} satisfies Config;
