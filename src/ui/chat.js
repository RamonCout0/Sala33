// =====================================================
//   UI — CHAT, PAINEL DE EMOJIS E RELÓGIO BRT
//   Camada de apresentação: monta o chat (com timestamps e
//   emojis Twemoji em grayscale), o painel de emojis e o
//   preview de skin. Nada de rede aqui (ver enviarEmote no main).
// =====================================================
import { PATHS_SPRITES } from "../world/config.js";

const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/";

const EMOJIS_PAINEL = [
    "😊", "😢", "😂", "😅", "😐", "😡",
    "💀", "🔥", "👑", "🏆", "😎", "🤓",
    "❤️", "💔", "👍", "👎", "🤝", "✌️",
    "😱", "🤔", "😴", "👀", "🫡", "😏",
    "☕", "🌙", "⭐", "🎠", "🎢", "💫",
];

export function horaAtualBrasil() {
    return new Date().toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit", minute: "2-digit",
    });
}

export function _aplicarGrayscaleEmojis(el) {
    if (!el) return;
    el.querySelectorAll("img.emoji").forEach(img => {
        img.style.cssText += "; filter: grayscale(100%) brightness(0.8) !important; width: 1em; height: 1em; vertical-align: -0.15em;";
    });
}

export function inicializarPainelEmojis() {
    const painel = document.getElementById("emojiPanel");
    if (!painel) return;
    EMOJIS_PAINEL.forEach(emoji => {
        const btn = document.createElement("button");
        btn.className = "emoji-btn";
        btn.textContent = emoji;
        if (window.twemoji) {
            twemoji.parse(btn, { base: TWEMOJI_BASE, folder: "72x72", ext: ".png" });
            _aplicarGrayscaleEmojis(btn);
            btn.querySelectorAll("img.emoji").forEach(img => {
                img.style.width = "18px";
                img.style.height = "18px";
            });
        }
        btn.onclick = () => {
            const input = document.getElementById("chatInput");
            input.value += emoji;
            input.focus();
        };
        painel.appendChild(btn);
    });
    const toggle = document.getElementById("emojiToggle");
    if (toggle && window.twemoji) {
        twemoji.parse(toggle, { base: TWEMOJI_BASE, folder: "72x72", ext: ".png" });
        _aplicarGrayscaleEmojis(toggle);
        toggle.querySelectorAll("img.emoji").forEach(img => {
            img.style.width = "20px";
            img.style.height = "20px";
        });
    }
}

export function togglePainelEmoji() {
    document.getElementById("emojiPanel")?.classList.toggle("aberto");
}
window.togglePainelEmoji = togglePainelEmoji;

// Fecha o painel de emoji ao clicar fora dele
document.addEventListener("click", (e) => {
    const container = document.getElementById("emojiBarContainer");
    if (container && !container.contains(e.target))
        document.getElementById("emojiPanel")?.classList.remove("aberto");
});

// Relógio BRT no chat (atualiza a cada segundo)
setInterval(() => {
    const el = document.getElementById("relogioChat");
    if (el) el.textContent = "// " + horaAtualBrasil() + " BRT";
}, 1000);

// Adiciona uma mensagem ao chat. `textos` = [{text, bold?}]. Usa textContent
// (não innerHTML) pra evitar XSS; os emojis viram <img> via Twemoji.
export function appendChatMsg(className, textos) {
    const chatBox = document.getElementById("chatBox");
    const div = document.createElement("div");
    if (className) div.className = className;

    // Timestamp BRT
    const hora = document.createElement("span");
    hora.className = "msg-hora";
    hora.textContent = horaAtualBrasil();
    div.appendChild(hora);

    for (const t of textos) {
        if (t.bold) {
            const strong = document.createElement("strong");
            strong.textContent = t.text;
            div.appendChild(strong);
        } else {
            div.appendChild(document.createTextNode(t.text));
        }
    }

    // Converte emojis em imagens Twemoji (grayscale via CSS)
    if (window.twemoji) {
        twemoji.parse(div, { base: TWEMOJI_BASE, folder: "72x72", ext: ".png" });
        _aplicarGrayscaleEmojis(div);
    }

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    // Sincroniza pro overlay mobile se estiver aberto
    const overlayBox = document.getElementById("chatOverlayBox");
    if (overlayBox && document.getElementById("chatOverlay")?.classList.contains("ativo")) {
        overlayBox.innerHTML = chatBox.innerHTML;
        overlayBox.scrollTop = overlayBox.scrollHeight;
    }
}

export function atualizarPreviewSkin() {
    const selectEl = document.getElementById("spriteSelect");
    if (!selectEl) return;
    const id = selectEl.value;
    const imgEl = document.getElementById("spritePreview");
    const fallbackEl = document.getElementById("fallbackText");
    if (PATHS_SPRITES[id]) {
        imgEl.src = PATHS_SPRITES[id];
        imgEl.onload = () => { imgEl.style.display = "block"; fallbackEl.style.display = "none"; };
        imgEl.onerror = () => { imgEl.style.display = "none"; fallbackEl.style.display = "block"; fallbackEl.innerText = "ERRO"; };
    } else {
        imgEl.style.display = "none"; fallbackEl.style.display = "block"; fallbackEl.innerText = "S/ SKIN";
    }
}
window.atualizarPreviewSkin = atualizarPreviewSkin;

// Converte atalhos de texto em emotes ASCII antes de enviar
export function traduzirEmotes(texto) {
    return texto
        .replace(/:\)/g, "(•‿•)")
        .replace(/:\(/g, "(╥﹏╥)")
        .replace(/<3/g, "(❤️)")
        .replace(/:[oO]/g, "(o_O)")
        .replace(/:[dD]/g, "(≧◡≦)")
        .replace(/;\)/g, "(━╤┳━)");
}
