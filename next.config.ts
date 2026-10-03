import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (pdfjs) грузит воркер из своего пакета по пути — при бандлинге он теряется
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
