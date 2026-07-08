// =====================================================
//   CONFIG DINÂMICA (carregada de JSON dos mods)
//   Estes objetos são preenchidos em runtime durante a
//   inicialização (a partir de public/mods/). São mutados
//   IN-PLACE (MAPAS[id] = ...), nunca reatribuídos — por
//   isso podem ser importados como bindings vivos.
// =====================================================
export const MAPAS = {};          // { salaId: { nome, imagemPath, portas, ... } }
export const PATHS_SPRITES = {};  // { spriteId: caminho }
export const AUDIO_PATHS = {};    // { salaId/faixa: caminho do mp3 }
