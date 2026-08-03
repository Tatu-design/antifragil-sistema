import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El repositorio de staging escribe en disco, así que estas rutas no se
  // pueden pre-renderizar como estáticas.
  experimental: {},
};

export default nextConfig;
