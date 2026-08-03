import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

// `next-env.d.ts` lo genera Next en cada build: no se edita a mano.
const configuracion = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default configuracion;
