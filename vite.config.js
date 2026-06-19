import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// SALA 33 — config do build do frontend.
//
// Estrutura:
//   index.html ......... entrada (raiz do projeto)
//   src/ ............... módulos ES
//   public/ ........... publicDir: assets, mods, wasm, reset.html, icons
//                       => copiado VERBATIM para dist/ no build. Os mods/logicas/*.js
//                          NUNCA são bundlados (são plugins carregados em runtime).
//
// Dev:  `npm run dev`  -> Vite em :5173 (HMR). O WebSocket vai direto pro Python em :8080.
// Prod: `npm run build` -> gera dist/ (com manifest PWA + service worker). O server.py serve dist/.
export default defineConfig({
  root: ".",
  publicDir: "public",
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["assets/favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Sala 33 — Backrooms 2D",
        short_name: "Sala 33",
        description: "MMO de chat de salas 2D estilo backrooms.",
        lang: "pt-BR",
        theme_color: "#0d0d0d",
        background_color: "#0d0d0d",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell: só código e arquivos pequenos no precache (install rápido).
        globPatterns: ["**/*.{js,css,html,svg,json}"],
        // Mídia pesada (música/mapas) e mods NÃO entram no precache.
        globIgnores: ["**/assets/music/**", "**/wasm/**"],
        // Cache em runtime (sob demanda) de imagens e áudio — não bloqueia o install.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "sala33-assets",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,   // necessário pro streaming de áudio (mp3)
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
