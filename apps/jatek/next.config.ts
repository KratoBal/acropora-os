import type { NextConfig } from "next";

/**
 * A NYEREMENYJATEK NYILVANOS OLDALA (apps/jatek). Kulon, kicsi app, sajat Coolify-alkalmazas, a bolttol es az OS
 * webjetol fuggetlenul. Az api cimet (`JATEK_API_URL`) FUTASIDOBEN olvassa, a szerver hivja: a bongeszo csak a
 * sajat `/api/*` utvonalait latja, az api cime nem kerul a lapra, es nem kell CORS. Epiteskor nem kell api-cim.
 */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
