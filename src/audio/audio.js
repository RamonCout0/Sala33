// =====================================================
//   ÁUDIO (lazy load)
//   Trilha por sala, carregada sob demanda. O volume é
//   global e persiste entre as faixas.
// =====================================================
import { AUDIO_PATHS } from "../world/config.js";

let volumeGeral = 0.5;
const audios = {};
let audioTocando = null;

function _criarAudio(id) {
    if (!audios[id]) {
        audios[id] = new Audio(AUDIO_PATHS[id]);
        audios[id].loop = true;
        audios[id].volume = volumeGeral;
        audios[id].preload = "auto";
    }
    return audios[id];
}

let _timerPrefetch = null;

/**
 * Pré-carrega em segundo plano as músicas das salas vizinhas (destinos das
 * portas da sala atual), pra que já estejam prontas ao atravessar a porta.
 * Espera um pouco antes de começar, pra música da sala atual ter prioridade
 * de banda. Respeita o modo "economia de dados" do navegador.
 */
export function preCarregarVizinhas(ids) {
    clearTimeout(_timerPrefetch);
    if (navigator.connection?.saveData) return;
    _timerPrefetch = setTimeout(() => {
        for (const id of new Set(ids)) {
            if (AUDIO_PATHS[id]) _criarAudio(id).load();
        }
    }, 2000);
}

// Retoma música quando o usuário volta à aba (mobile pausa áudio em background)
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && audioTocando) {
        audioTocando.play().catch(() => {});
    }
});

export function tocarMusica(id) {
    if (!AUDIO_PATHS[id]) return;
    _criarAudio(id);
    // Já está tocando essa faixa? não reinicia (evita corte ao reentrar na sala)
    if (audioTocando === audios[id] && !audios[id].paused) return;
    if (audioTocando && audioTocando !== audios[id]) {
        audioTocando.pause();
        audioTocando.currentTime = 0;
    }
    audioTocando = audios[id];
    audioTocando.volume = volumeGeral;
    // play() retorna promise — se falhar (autoplay bloqueado), ignora silenciosamente
    const p = audioTocando.play();
    if (p) p.catch(() => { /* aguarda interação do usuário */ });
}

export function ajustarVolume(v) {
    volumeGeral = Math.max(0, Math.min(1, parseFloat(v)));
    for (const id in audios) audios[id].volume = volumeGeral;
}
// Exposto no window porque o slider de volume no HTML chama via oninput.
window.ajustarVolume = ajustarVolume;
