import { defineConfig } from "vite";

// SALA 33 — config do build do frontend.
//
// Estrutura:
//   index.html ......... entrada (raiz do projeto)
//   src/ ............... módulos ES (game.js está sendo carvado pra cá, passo a passo)
//   public/ ........... publicDir: assets, mods, wasm, reset.html, game.js (clássico, temporário)
//                       => copiado VERBATIM para dist/ no build. Os mods/logicas/*.js
//                          NUNCA são bundlados (são plugins carregados em runtime).
//
// Dev:  `npm run dev`  -> Vite em :5173 (HMR). O WebSocket vai direto pro Python em :8080
//                         (ver _wsUrl no client). Rode o `python server.py` em paralelo.
// Prod: `npm run build` -> gera dist/. O server.py serve dist/ quando STATIC_DIR=dist
//                          (ou automaticamente, se a pasta dist/ existir).
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
});
