// =====================================================
//   UI — PAINEL DE PERFIL (editar sprite/bio + trocar senha)
//   Requer conta. Envia pelo net/socket; o estado do jogador
//   (meuBicho) e a bio atual vêm injetados via initPerfil().
// =====================================================
import { PATHS_SPRITES } from "../world/config.js";
import { enviar } from "../net/socket.js";

let _meuBicho = null;
let _getBio = () => "";

/** Injeta dependências do main.js: o objeto meuBicho e um getter da bio atual. */
export function initPerfil({ meuBicho, getBio }) {
    _meuBicho = meuBicho;
    if (getBio) _getBio = getBio;
}

let _perfilAberto = false;

export function _perfilMsg(texto, tipo) {
    const el = document.getElementById("perfilMsg");
    if (!el) return;
    el.textContent = texto;
    el.className = tipo || "";
    if (texto) setTimeout(() => { if (el.textContent === texto) { el.textContent = ""; el.className = ""; } }, 4000);
}

function _popularSpritesPerfil() {
    const sel = document.getElementById("perfilSpriteSelect");
    if (!sel || sel.options.length > 0) return;
    // Reutiliza PATHS_SPRITES carregados na inicialização
    for (const [id, path] of Object.entries(PATHS_SPRITES)) {
        const opt = document.createElement("option");
        opt.value = id;
        // Tenta buscar o nome do select principal do menu
        const mainOpt = document.querySelector(`#spriteSelect option[value="${id}"]`);
        opt.textContent = mainOpt ? mainOpt.textContent : id.toUpperCase();
        sel.appendChild(opt);
    }
    sel.value = _meuBicho.spriteId || "cinzaguy";
    sel.addEventListener("change", _atualizarPreviewPerfil);
    _atualizarPreviewPerfil();
}

function _atualizarPreviewPerfil() {
    const sel = document.getElementById("perfilSpriteSelect");
    const img = document.getElementById("perfilSpritePreview");
    const fb  = document.getElementById("perfilFallback");
    if (!sel || !img) return;
    const path = PATHS_SPRITES[sel.value];
    if (path) {
        img.src = path;
        img.style.display = "block";
        if (fb) fb.style.display = "none";
    } else {
        img.style.display = "none";
        if (fb) fb.style.display = "block";
    }
}

export function togglePerfil() {
    const overlay = document.getElementById("perfilOverlay");
    const painel  = document.getElementById("perfilPanel");
    if (!painel) return;
    _perfilAberto = !_perfilAberto;
    if (_perfilAberto) {
        // Popula campos com dados atuais
        const nomeEl = document.getElementById("perfilUsername");
        if (nomeEl) nomeEl.textContent = _meuBicho.username || "";
        const bioEl = document.getElementById("perfilBio");
        if (bioEl) bioEl.value = _getBio() || "";
        _popularSpritesPerfil();
        // Sincroniza sprite selecionado com o atual
        const sel = document.getElementById("perfilSpriteSelect");
        if (sel) { sel.value = _meuBicho.spriteId || "cinzaguy"; _atualizarPreviewPerfil(); }
        // Limpa campos de senha
        ["perfilSenhaAtual","perfilNovaSenha","perfilConfirmarSenha"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        _perfilMsg("", "");
        if (overlay) overlay.style.display = "block";
        painel.style.display = "block";
    } else {
        if (overlay) overlay.style.display = "none";
        painel.style.display = "none";
    }
}
window.togglePerfil = togglePerfil;

export function fecharPerfilOverlay(e) {
    if (e.target === document.getElementById("perfilOverlay")) togglePerfil();
}
window.fecharPerfilOverlay = fecharPerfilOverlay;

export function salvarPerfil() {
    const sprite = document.getElementById("perfilSpriteSelect")?.value;
    const bio    = document.getElementById("perfilBio")?.value || "";
    if (!enviar({ tipo: "atualizar_perfil", sprite_id: sprite, bio: bio.trim() }))
        return _perfilMsg("Sem conexão.", "erro");
    const btn = document.getElementById("btnSalvarPerfil");
    if (btn) { btn.disabled = true; btn.textContent = "SALVANDO..."; }
}
window.salvarPerfil = salvarPerfil;

export function trocarSenhaPerfil() {
    const senhaAtual = document.getElementById("perfilSenhaAtual")?.value || "";
    const novaSenha  = document.getElementById("perfilNovaSenha")?.value || "";
    const confirmar  = document.getElementById("perfilConfirmarSenha")?.value || "";
    if (!senhaAtual) return _perfilMsg("Digite a senha atual.", "erro");
    if (novaSenha.length < 6) return _perfilMsg("Nova senha precisa de 6+ caracteres.", "erro");
    if (novaSenha !== confirmar) return _perfilMsg("As senhas não coincidem.", "erro");
    if (!enviar({ tipo: "trocar_senha", senha_atual: senhaAtual, nova_senha: novaSenha }))
        return _perfilMsg("Sem conexão.", "erro");
    const btn = document.getElementById("btnTrocarSenha");
    if (btn) { btn.disabled = true; btn.textContent = "ALTERANDO..."; }
}
window.trocarSenhaPerfil = trocarSenhaPerfil;
