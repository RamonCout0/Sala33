// =====================================================
//   SALA 33 — ENGINE CORE
//   Carrega mapas, personagens e lógicas dinamicamente
//   a partir de public/mods/.
// =====================================================
import { Wasm } from "./core/wasm.js";
import { MAPAS, PATHS_SPRITES, AUDIO_PATHS } from "./world/config.js";
import { precarregarAudios, tocarMusica, ajustarVolume } from "./audio/audio.js";
import { initParticles, spawnFumaca, atualizarFumacas, desenharFumacas } from "./render/particles.js";
import { inicializarPainelEmojis, appendChatMsg, atualizarPreviewSkin, traduzirEmotes, horaAtualBrasil, _aplicarGrayscaleEmojis } from "./ui/chat.js";
import { setSocket, _wsUrl } from "./net/socket.js";
import { initPerfil, _perfilMsg } from "./ui/perfil.js";
import { initAuth, _authMsg } from "./ui/auth.js";
import { initSocial, estadoSocial, renderizarSocial, renderizarPV, _registrarPV, _socialMsg, pedirEstadoSala, enviarPV, fecharPV } from "./ui/social.js";

// ----- Sistema de plugins de lógica por sala -----
window.SALA33_LOGICAS = {};
window.SALA33_REGISTRAR = function (salaId, logica) {
    window.SALA33_LOGICAS[salaId] = logica;
};
function getLogica() { return window.SALA33_LOGICAS[minhaSala] || null; }

// =====================================================
//   ESTADO GLOBAL
// =====================================================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
initParticles(ctx);   // injeta o ctx no módulo de partículas
let ws;

let minhaSala = "";
let meuSid = null;  // session id enviado pelo servidor
let meuBicho = {
    username: "", x: 200, y: 150, velocidade: 2, tamanho: 32,
    chatTexto: "", chatTimer: 0, isTyping: false,
    spriteId: "cinzaguy", lado: "direita", animTick: 0,
    isDev: false,  // <-- ADICIONADO: flag de desenvolvedor
};
let outrosJogadores = {};
let teclas = {};

let transicaoAlpha = 0;
let estadoTransicao = "idle";
let portaPendente = null;
let legendaTimer = 0;

let tempoAnterior = 0;
const intervaloFps = 1000 / 60;

// Throttle de envio de movimento: manda no máximo ~15x/s (a cada ~66ms)
// em vez de 60x/s. Evita floodar o rate limiter do servidor (causa dos "TPs").
let ultimoEnvioMov = 0;
const INTERVALO_MOV_MS = 66;
let movPendente = false;   // há posição nova não enviada?

let mostrarDebug = false;
let tremorTela = 0;
let mouseX = 0, mouseY = 0;

// Debug log (eventos de sistema — só visíveis via F2)
const debugLog = [];
const DEBUG_LOG_MAX = 60;

function registrarDebug(categoria, mensagem, meta) {
    debugLog.push({ categoria, mensagem, meta: meta || {}, ts: horaAtualBrasil() });
    if (debugLog.length > DEBUG_LOG_MAX) debugLog.shift();
}

// =====================================================
//   CONFIG DINÂMICA (carregada de JSON)
// =====================================================
// MAPAS / PATHS_SPRITES / AUDIO_PATHS vivem em world/config.js (bindings vivos,
// mutados in-place na inicialização). SALA_INICIAL é reatribuído, então fica local.
let SALA_INICIAL = "the_hub";

// Áudio (precarregarAudios / tocarMusica / ajustarVolume) vive em audio/audio.js

// =====================================================
//   IMAGENS
// =====================================================
const imagensSprites = {};
const imagensCenarios = {};

function carregarImagens() {
    // Cache-bust via timestamp: garante que o browser sempre busca a versão
    // mais recente dos assets, ignorando qualquer cache local ou de CDN.
    const bust = `?v=${Date.now()}`;
    for (const id in PATHS_SPRITES) {
        imagensSprites[id] = new Image();
        imagensSprites[id].src = PATHS_SPRITES[id] + bust;
    }
    for (const nomeSala in MAPAS) {
        imagensCenarios[nomeSala] = new Image();
        imagensCenarios[nomeSala].src = MAPAS[nomeSala].imagemPath + bust;
    }
}

// =====================================================
//   INICIALIZAÇÃO — carrega tudo de mods/
// =====================================================
async function inicializar() {
    const btn = document.getElementById("btnEntrar");
    btn.disabled = true;
    btn.textContent = "CARREGANDO...";

    try {
        // 1. Manifest
        const manifest = await fetch("mods/manifest.json").then(r => r.json());
        SALA_INICIAL = manifest.salaInicial || "the_hub";

        // 2. Salas (lê uma JSON por sala)
        await Promise.all((manifest.salas || []).map(async id => {
            const sala = await fetch(`mods/salas/${id}.json`).then(r => r.json());
            MAPAS[id] = {
                nome: sala.nome,
                corFundo: sala.corFundo || "#1a1a1a",
                imagemPath: sala.imagem,
                portas: sala.portas || [],
                extras: sala.extras || {},
            };
            if (sala.musica) AUDIO_PATHS[id] = sala.musica;
            // Músicas extras (ex.: minigames)
            if (sala.musicasExtras) {
                for (const k in sala.musicasExtras) {
                    if (k.startsWith("_")) continue; // pula chaves de comentário
                    AUDIO_PATHS[k] = sala.musicasExtras[k];
                }
            }
        }));

        // 3. Personagens — popula o dropdown
        const personagens = await fetch("mods/personagens.json").then(r => r.json());
        const select = document.getElementById("spriteSelect");
        select.innerHTML = "";
        for (const p of personagens) {
            PATHS_SPRITES[p.id] = p.sprite;
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.nome;
            select.appendChild(opt);
        }

        // Restaura escolhas salvas
        const salvoUser = localStorage.getItem("sala33_username");
        const salvoSprite = localStorage.getItem("sala33_spriteId");
        if (salvoUser) document.getElementById("username").value = salvoUser;
        if (salvoSprite && PATHS_SPRITES[salvoSprite]) select.value = salvoSprite;
        select.addEventListener("change", atualizarPreviewSkin);
        atualizarPreviewSkin();

        // 4. Lógicas (script tags carregados dinamicamente)
        if (manifest.logicas?.length) {
            await Promise.all(manifest.logicas.map(id => new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = `mods/logicas/${id}.js`;
                s.onload = res;
                s.onerror = () => { console.warn(`Lógica não carregada: ${id}`); res(); };
                document.head.appendChild(s);
            })));
        }

        // 5. Imagens + WASM
        minhaSala = SALA_INICIAL;
        carregarImagens();
        inicializarPainelEmojis();
        Wasm.init(); // async, sem bloquear — fallback JS ativo enquanto carrega

        btn.disabled = false;
        btn.textContent = "ENTRAR";
    } catch (e) {
        console.error("Erro ao carregar configs:", e);
        btn.textContent = "ERRO — VEJA O CONSOLE";
    }
}

// Chat, painel de emojis, relógio BRT e preview de skin vivem em ui/chat.js
// (appendChatMsg / traduzirEmotes / inicializarPainelEmojis / atualizarPreviewSkin).

function enviarEmote(emote) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "chat", texto: emote }));
        meuBicho.chatTexto = emote;
        meuBicho.chatTimer = 240;
    }
}
window.enviarEmote = enviarEmote;

// Autenticação (abas, login/registro/reset) vive em ui/auth.js.
// O main.js injeta os callbacks de "entrar" via initAuth (logo abaixo, após
// as declarações de estado de conta).

// =====================================================
//   PAINEL SOCIAL (amigos + favoritos + pedidos + PV)
// =====================================================
let contaAtiva = false;            // logado com conta?
let meuUserId = null;              // meu id de usuário (conta)
let meuBio = "";                   // bio do perfil

// Injeta no módulo de perfil o jogador e um getter da bio atual
initPerfil({ meuBicho, getBio: () => meuBio });

// Injeta no módulo de auth como entrar no jogo (convidado ou com conta)
initAuth({
    conectarConvidado: () => conectar(),
    aoEntrarComConta: (user, token) => {
        localStorage.setItem("sala33_token", token);
        meuBicho.username = user.username;
        meuBicho.spriteId = user.sprite_id || "cinzaguy";
        meuBicho.isDev    = !!user.isDev;
        meuUserId = user.id;
        meuBio    = user.bio || "";
        conectar({ token });   // entra no jogo usando o token
    },
});

// Injeta no módulo social os acessos ao estado do jogo
initSocial({
    meuBicho,
    getMinhaSala: () => minhaSala,
    getContaAtiva: () => contaAtiva,
    getOutrosJogadores: () => outrosJogadores,
});



// Dispara a animação visual de teleporte (flash cinza + label "TELEPORTADO")
function animarTeleporte() {
    const flash = document.getElementById("tpFlash");
    const label = document.getElementById("tpLabel");
    if (flash) {
        flash.classList.remove("ativo");
        void flash.offsetWidth;        // força reflow pra reiniciar a animação
        flash.classList.add("ativo");
    }
    if (label) {
        label.classList.remove("ativo");
        void label.offsetWidth;
        label.classList.add("ativo");
    }
}

// Partículas de fumaça (spawnFumaca / atualizarFumacas / desenharFumacas) vivem em render/particles.js


// =====================================================
//   CONEXÃO WEBSOCKET
// =====================================================
function conectar(opts = {}) {
    const token = opts.token || null;

    if (token) {
        // Login por conta: username/sprite já vieram do auth_ok
        if (!meuBicho.username) return _authMsg("Erro: sessão sem usuário.", "erro");
    } else {
        // Login convidado: lê os campos do menu
        const user = document.getElementById("username").value;
        const skin = document.getElementById("spriteSelect").value;
        if (!user) return alert("Digite um nome!");
        if (!Object.keys(MAPAS).length) return alert("Configs ainda não carregaram. Recarregue a página.");
        meuBicho.username = user.toUpperCase().trim();
        meuBicho.spriteId = skin;
        localStorage.setItem("sala33_username", meuBicho.username);
        localStorage.setItem("sala33_spriteId", skin);
    }

    document.getElementById("menu").style.display = "none";
    document.getElementById("gameUI").style.display = "flex";

    tocarMusica(SALA_INICIAL);

    ws = new WebSocket(_wsUrl());
    setSocket(ws);   // registra o socket no módulo net pra os módulos de UI usarem enviar()

    ws.onopen = () => {
        const payloadLogin = token
            ? { tipo: "login", token, spriteId: meuBicho.spriteId, lado: meuBicho.lado }
            : { tipo: "login", username: meuBicho.username, spriteId: meuBicho.spriteId, lado: meuBicho.lado };
        ws.send(JSON.stringify(payloadLogin));
        legendaTimer = 180;
        precarregarAudios();
        setupMobileControls();
        getLogica()?.onEnter?.(MAPAS[minhaSala]);
        requestAnimationFrame(loop);
    };

    ws.onmessage = (event) => {
        const dados = JSON.parse(event.data);

        if (dados.tipo === "erro_login") {
            alert(dados.mensagem);
            ws.close();
            document.getElementById("menu").style.display = "block";
            document.getElementById("gameUI").style.display = "none";
            return;
        }

        if (dados.tipo === "novo_jogador") {
            if (dados.id !== meuSid) {
                dados.chatTexto = ""; dados.chatTimer = 0; dados.isTyping = false;
                dados.lado = dados.lado || "direita";
                dados.animTick = 0; dados.movimentoTimer = 0;
                dados.targetX = dados.x;   // inicializa alvo p/ interpolação
                dados.targetY = dados.y;
                dados.isDev = !!dados.isDev;  // <-- ADICIONADO: recebe flag isDev do servidor
                outrosJogadores[dados.id] = dados;
                // Se chegou por teleporte, solta fumaça na posição dele
                if (dados.tp) {
                    spawnFumaca(dados.x + meuBicho.tamanho / 2, dados.y + meuBicho.tamanho / 2);
                }
            }
            // Evento de sistema — só no debug mode (não polui o chat)
            registrarDebug("join", `» ${dados.username} entrou.`);
        }
        else if (dados.tipo === "lista_jogadores") {
            // O servidor envia nosso próprio sid na primeira lista
            if (dados.meu_sid) meuSid = dados.meu_sid;
            meuBicho.isDev = !!dados.isDev;  // <-- ADICIONADO: recebe flag isDev do servidor
            // Conta logada? ativa o painel social e popula amigos/favoritos/pedidos
            if (dados.conta) {
                contaAtiva = true;
                estadoSocial.amigos = dados.amigos || [];
                estadoSocial.favoritos = dados.favoritos || [];
                estadoSocial.pedidos = dados.pedidos || [];
                estadoSocial.online = new Set(dados.online || []);
                const btnSocial = document.getElementById("btnSocialToggle");
                if (btnSocial) btnSocial.style.display = "block";
                const btnPerfil = document.getElementById("btnPerfilToggle");
                if (btnPerfil) btnPerfil.style.display = "block";
                // Avisa se houver pedidos pendentes
                if (estadoSocial.pedidos.length > 0) {
                    registrarDebug("info", `» ${estadoSocial.pedidos.length} pedido(s) de amizade.`);
                }
                registrarDebug("info", `» Logado como conta (${meuBicho.username}).`);
                renderizarSocial();
                pedirEstadoSala();   // pega likes da sala inicial
            }
            dados.jogadores.forEach(p => {
                if (p.id !== meuSid) {
                    p.chatTexto = ""; p.chatTimer = 0; p.isTyping = false;
                    p.lado = p.lado || "direita";
                    p.animTick = 0; p.movimentoTimer = 0;
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.isDev = !!p.isDev;
                    outrosJogadores[p.id] = p;
                }
            });
        }
        else if (dados.tipo === "amigos") {
            estadoSocial.amigos = dados.lista || [];
            if (dados.online) estadoSocial.online = new Set(dados.online);
            if (dados.pedidos) estadoSocial.pedidos = dados.pedidos;
            renderizarSocial();
        }
        else if (dados.tipo === "pedido_recebido") {
            // Alguém me mandou pedido enquanto estou online
            const de = dados.de;
            if (de && !estadoSocial.pedidos.some(p => p.id === de.id)) {
                estadoSocial.pedidos.push(de);
            }
            appendChatMsg("sistema", [{text: `» ${de.username} quer ser seu amigo! Abra o painel ★ AMIGOS.`}]);
            registrarDebug("info", `» Pedido de amizade de ${de.username}.`);
            renderizarSocial();
        }
        else if (dados.tipo === "pedido_enviado") {
            _socialMsg(dados.mensagem || "Pedido enviado.", "ok");
        }
        else if (dados.tipo === "pedido_recusado") {
            estadoSocial.pedidos = estadoSocial.pedidos.filter(p => p.id !== dados.from_id);
            renderizarSocial();
        }
        else if (dados.tipo === "amigo_erro") {
            _socialMsg(dados.mensagem || "Não foi possível.", "erro");
        }
        else if (dados.tipo === "favorito_estado") {
            if (dados.favoritado === true) {
                if (!estadoSocial.favoritos.includes(dados.room_id)) estadoSocial.favoritos.push(dados.room_id);
                _socialMsg(`Sala favoritada!`, "ok");
            } else if (dados.favoritado === false) {
                estadoSocial.favoritos = estadoSocial.favoritos.filter(r => r !== dados.room_id);
                _socialMsg(`Sala removida dos favoritos.`, "ok");
            }
            renderizarSocial();
        }
        else if (dados.tipo === "like_estado") {
            estadoSocial.likes[dados.room_id] = {
                total: dados.total || 0,
                curtiu: dados.curtiu === true,
            };
            renderizarSocial();
        }
        else if (dados.tipo === "tp_ok") {
            // Teleporte até o amigo: troca de sala client-side
            minhaSala = dados.sala;
            meuBicho.x = dados.x;
            meuBicho.y = dados.y;
            if (dados.meu_sid) meuSid = dados.meu_sid;
            outrosJogadores = {};
            (dados.jogadores || []).forEach(p => {
                if (p.id !== meuSid) {
                    p.chatTexto = ""; p.chatTimer = 0; p.isTyping = false;
                    p.lado = p.lado || "direita";
                    p.animTick = 0; p.movimentoTimer = 0;
                    p.targetX = p.x; p.targetY = p.y;
                    p.isDev = !!p.isDev;
                    outrosJogadores[p.id] = p;
                }
            });
            legendaTimer = 180;
            tocarMusica(minhaSala);
            getLogica()?.onEnter?.(MAPAS[minhaSala]);
            animarTeleporte();      // flash + label "TELEPORTADO"
            spawnFumaca(meuBicho.x + meuBicho.tamanho / 2, meuBicho.y + meuBicho.tamanho / 2);
            pedirEstadoSala();      // atualiza likes da nova sala
            renderizarSocial();     // atualiza botões de fav/like pra nova sala
            _socialMsg("Teleportado!", "ok");
        }
        else if (dados.tipo === "tp_erro") {
            _socialMsg(dados.mensagem || "Não foi possível teleportar.", "erro");
        }
        else if (dados.tipo === "pv") {
            // Mensagem privada (recebida ou eco da minha própria)
            const souEu = dados.eco === true;
            const friendId = souEu ? dados.para_id : dados.de_id;
            _registrarPV(friendId, dados.de_nome, dados.texto, souEu);
            if (!souEu) {
                // Notifica no chat principal se o PV não estiver aberto com ele
                if (!estadoSocial.pvAtual || estadoSocial.pvAtual.id !== friendId) {
                    appendChatMsg("sistema", [{text: `✉ PV de ${dados.de_nome}: ${dados.texto}`}]);
                }
            }
        }
        else if (dados.tipo === "pv_erro") {
            _socialMsg(dados.mensagem || "Erro no PV.", "erro");
        }
        else if (dados.tipo === "perfil_ok") {
            _perfilMsg("Perfil salvo!", "ok");
            if (dados.user) {
                if (dados.user.sprite_id) meuBicho.spriteId = dados.user.sprite_id;
                if (dados.user.bio !== undefined) {
                    meuBio = dados.user.bio || "";
                    const bioEl = document.getElementById("perfilBio");
                    if (bioEl) bioEl.value = meuBio;
                }
            }
            const btn = document.getElementById("btnSalvarPerfil");
            if (btn) { btn.disabled = false; btn.textContent = "SALVAR PERFIL"; }
        }
        else if (dados.tipo === "perfil_erro") {
            _perfilMsg(dados.mensagem || "Erro ao salvar.", "erro");
            const btn = document.getElementById("btnSalvarPerfil");
            if (btn) { btn.disabled = false; btn.textContent = "SALVAR PERFIL"; }
        }
        else if (dados.tipo === "senha_ok") {
            _perfilMsg(dados.mensagem || "Senha alterada!", "ok");
            const btn = document.getElementById("btnTrocarSenha");
            if (btn) { btn.disabled = false; btn.textContent = "ALTERAR SENHA"; }
            document.getElementById("perfilSenhaAtual").value = "";
            document.getElementById("perfilNovaSenha").value = "";
            document.getElementById("perfilConfirmarSenha").value = "";
        }
        else if (dados.tipo === "senha_erro") {
            _perfilMsg(dados.mensagem || "Erro ao trocar senha.", "erro");
            const btn = document.getElementById("btnTrocarSenha");
            if (btn) { btn.disabled = false; btn.textContent = "ALTERAR SENHA"; }
        }
        else if (dados.tipo === "movimento") {
            if (outrosJogadores[dados.id]) {
                if (dados.x > outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "direita";
                else if (dados.x < outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "esquerda";
                outrosJogadores[dados.id].targetX = dados.x;
                outrosJogadores[dados.id].targetY = dados.y;
                outrosJogadores[dados.id].movimentoTimer = 6;
            }
        }
        else if (dados.tipo === "jogador_saiu") {
            if (outrosJogadores[dados.id]) {
                registrarDebug("leave", `« ${outrosJogadores[dados.id].username} saiu.`);
                delete outrosJogadores[dados.id];
            }
        }
        else if (dados.tipo === "debug_event") {
            registrarDebug(dados.categoria || "info", dados.mensagem || "", dados.meta);
        }
        else if (dados.tipo === "chat") {
            appendChatMsg("", [{text: `[${dados.username}]: `, bold: true}, {text: dados.texto}]);
            if (dados.username === meuBicho.username) { meuBicho.chatTexto = dados.texto; meuBicho.chatTimer = 240; }
            else {
                for (const id in outrosJogadores) {
                    if (outrosJogadores[id].username === dados.username) {
                        outrosJogadores[id].chatTexto = dados.texto;
                        outrosJogadores[id].chatTimer = 240;
                        break;
                    }
                }
            }
        }
        else if (dados.tipo === "jogador_digitando") {
            if (outrosJogadores[dados.id]) outrosJogadores[dados.id].isTyping = dados.estado;
        }
        else {
            // Repassa para a lógica da sala atual
            getLogica()?.onMensagem?.(dados, ws, meuBicho, tocarMusica, minhaSala);
        }
    };
}
window.conectar = conectar;

// =====================================================
//   INPUT
// =====================================================
const chatInput = document.getElementById("chatInput");

chatInput.addEventListener("focus", () => {
    teclas = {};
    meuBicho.animTick = 0;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: "digitando", estado: true }));
});
chatInput.addEventListener("blur", () => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: "digitando", estado: false }));
});
chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && chatInput.value.trim()) {
        ws.send(JSON.stringify({ tipo: "chat", texto: traduzirEmotes(chatInput.value) }));
        chatInput.value = "";
        chatInput.blur();
    }
});

// Enter no chat privado (PV)
const pvInputEl = document.getElementById("pvInput");
if (pvInputEl) {
    pvInputEl.addEventListener("keypress", (e) => {
        if (e.key === "Enter") { e.preventDefault(); enviarPV(); }
    });
}

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    mouseY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
});

window.addEventListener("keydown", (e) => {
    // Está digitando em algum campo de texto? (chat, PV, adicionar amigo, perfil…)
    const ae = document.activeElement;
    const digitando = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");

    // Enter foca o chat — só quando NÃO estou digitando em nenhum campo
    if (e.code === "Enter" && !digitando) {
        e.preventDefault();
        chatInput.focus();
        return;
    }
    // Digitando? não captura teclas de jogo (senão WASD anda o boneco enquanto escreve)
    if (digitando) return;
    teclas[e.code] = true;

    // Hotkeys globais
    if (e.code === "F2") { e.preventDefault(); mostrarDebug = !mostrarDebug; return; }
    if (e.code === "F1") {
        e.preventDefault();
        const cm = document.getElementById("configMenu");
        if (cm) cm.style.display = (cm.style.display === "none" || !cm.style.display) ? "block" : "none";
        return;
    }

    // Q universal — fecha overlays, sai de minigames
    if (e.code === "KeyQ") {
        const painel = document.getElementById("emojiPanel");
        if (painel?.classList.contains("aberto")) {
            painel.classList.remove("aberto");
            e.preventDefault(); return;
        }
        // PV aberto?
        const pv = document.getElementById("pvPanel");
        if (pv?.classList.contains("aberto")) {
            fecharPV();
            e.preventDefault(); return;
        }
        // Painel social aberto?
        const social = document.getElementById("socialPanel");
        if (social?.classList.contains("aberto")) {
            social.classList.remove("aberto");
            e.preventDefault(); return;
        }
        const overlay = document.getElementById("chatOverlay");
        if (overlay?.classList.contains("ativo")) {
            window.fecharChatMobile?.();
            e.preventDefault(); return;
        }
        // Se não fechou nada, passa pra lógica da sala (Pong/Aura/etc)
    }

    if (ws?.readyState === WebSocket.OPEN) {
        const consumido = getLogica()?.onTeclaDown?.(e.code, ws, meuBicho);
        if (consumido) e.preventDefault();
    }
});
window.addEventListener("keyup", (e) => { teclas[e.code] = false; });
window.addEventListener("blur", () => { teclas = {}; meuBicho.animTick = 0; });

// =====================================================
//   CONTROLES MOBILE (TOUCH)
// =====================================================
function setupMobileControls() {
    if (!("ontouchstart" in window)) return;

    // Ativa o overlay do d-pad
    document.getElementById("mobileControls")?.classList.add("ativo");

    // Mapeia botões do d-pad para códigos de tecla
    const mapeamento = {
        "btn-up":    "ArrowUp",
        "btn-down":  "ArrowDown",
        "btn-left":  "ArrowLeft",
        "btn-right": "ArrowRight",
    };
    for (const [id, code] of Object.entries(mapeamento)) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.addEventListener("touchstart", e => { e.preventDefault(); teclas[code] = true; }, { passive: false });
        btn.addEventListener("touchend",   e => { e.preventDefault(); teclas[code] = false; }, { passive: false });
        btn.addEventListener("touchcancel",e => { e.preventDefault(); teclas[code] = false; }, { passive: false });
    }

    // Botão de interação [E]
    document.getElementById("btn-interact")?.addEventListener("touchstart", e => {
        e.preventDefault();
        if (ws?.readyState === WebSocket.OPEN) {
            teclas["KeyE"] = true;
            getLogica()?.onTeclaDown?.("KeyE", ws, meuBicho);
            setTimeout(() => { teclas["KeyE"] = false; }, 150);
        }
    }, { passive: false });

    // Botão de chat — abre overlay
    document.getElementById("btn-chat-open")?.addEventListener("touchstart", e => {
        e.preventDefault();
        abrirChatMobile();
    }, { passive: false });

    // Input do chat overlay
    const overlayInput = document.getElementById("chatOverlayInput");
    if (overlayInput) {
        overlayInput.addEventListener("keypress", e => {
            if (e.key === "Enter" && overlayInput.value.trim()) {
                ws.send(JSON.stringify({ tipo: "chat", texto: traduzirEmotes(overlayInput.value) }));
                overlayInput.value = "";
                overlayInput.blur();
            }
        });
    }
}

function abrirChatMobile() {
    const overlay = document.getElementById("chatOverlay");
    if (!overlay) return;
    overlay.classList.add("ativo");
    // Sincroniza mensagens do chatBox desktop pro overlay
    const boxDesktop = document.getElementById("chatBox");
    const boxMobile  = document.getElementById("chatOverlayBox");
    if (boxDesktop && boxMobile) boxMobile.innerHTML = boxDesktop.innerHTML;
    setTimeout(() => document.getElementById("chatOverlayInput")?.focus(), 100);
}
window.fecharChatMobile = function() {
    document.getElementById("chatOverlay")?.classList.remove("ativo");
};

// =====================================================
//   FÍSICA
// =====================================================
function atualizarFisica() {
    if (estadoTransicao !== "idle") { processarTransicao(); return; }

    // Pergunta para a lógica da sala se ela quer bloquear o movimento
    const fisicaResult = getLogica()?.onFisica?.(meuBicho, ws, teclas) || { bloqueiaMovimento: false, tremor: 0 };
    tremorTela = fisicaResult.tremor || 0;

    if (!fisicaResult.bloqueiaMovimento) {
        let dx = 0, dy = 0;
        if (teclas["ArrowUp"] || teclas["KeyW"]) dy -= 1;
        if (teclas["ArrowDown"] || teclas["KeyS"]) dy += 1;
        if (teclas["ArrowLeft"] || teclas["KeyA"]) { dx -= 1; meuBicho.lado = "esquerda"; }
        if (teclas["ArrowRight"] || teclas["KeyD"]) { dx += 1; meuBicho.lado = "direita"; }

        if (dx !== 0 || dy !== 0) {
            let v = meuBicho.velocidade;
            if (dx !== 0 && dy !== 0) v *= 0.7071;
            meuBicho.x += dx * v;
            meuBicho.y += dy * v;
            meuBicho.animTick += 0.25;
            movPendente = true;   // marca que há nova posição pra enviar
        } else {
            meuBicho.animTick = 0;
        }

        meuBicho.x = Math.max(0, Math.min(canvas.width - meuBicho.tamanho, meuBicho.x));
        meuBicho.y = Math.max(0, Math.min(canvas.height - meuBicho.tamanho, meuBicho.y));

        // Envia movimento com throttle (~15x/s) em vez de a cada frame.
        // Isso evita floodar o servidor e elimina os "TPs" que outros viam.
        const agora = performance.now();
        if (movPendente && agora - ultimoEnvioMov >= INTERVALO_MOV_MS) {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ tipo: "mover", x: meuBicho.x, y: meuBicho.y, lado: meuBicho.lado }));
            }
            ultimoEnvioMov = agora;
            movPendente = false;
        }

        // Verifica portas (usa WASM se disponível)
        for (const porta of (MAPAS[minhaSala]?.portas || [])) {
            if (Wasm.checkRectOverlap(
                meuBicho.x, meuBicho.y, meuBicho.tamanho, meuBicho.tamanho,
                porta.x, porta.y, porta.w, porta.h
            )) {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ tipo: "digitando", estado: false }));
                }
                estadoTransicao = "fade_out";
                portaPendente = porta;
                break;
            }
        }
    }

    // Anima outros jogadores
    for (const id in outrosJogadores) {
        const p = outrosJogadores[id];
        if (p.movimentoTimer > 0) { p.movimentoTimer--; p.animTick += 0.25; }
        else p.animTick = 0;
    }

    if (meuBicho.chatTimer > 0) meuBicho.chatTimer--;
    for (const id in outrosJogadores) {
        if (outrosJogadores[id].chatTimer > 0) outrosJogadores[id].chatTimer--;
    }
    if (legendaTimer > 0) legendaTimer--;
    
    // <-- ADICIONADO: atualiza partículas de fumaça
    atualizarFumacas();
}

function processarTransicao() {
    if (estadoTransicao === "fade_out") {
        transicaoAlpha += 0.05;
        if (transicaoAlpha >= 1) {
            transicaoAlpha = 1;
            // Notifica a lógica antiga que estamos saindo
            getLogica()?.onSair?.();

            minhaSala = portaPendente.destino;
            meuBicho.x = portaPendente.spawnX;
            meuBicho.y = portaPendente.spawnY;
            outrosJogadores = {};
            legendaTimer = 180;
            estadoTransicao = "fade_in";
            teclas = {};
            tremorTela = 0;

            tocarMusica(portaPendente.destino);

            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    tipo: "mudar_sala", nova_sala: portaPendente.destino,
                    x: portaPendente.spawnX, y: portaPendente.spawnY, lado: meuBicho.lado,
                }));
            }
            // Notifica a nova lógica
            getLogica()?.onEnter?.(MAPAS[minhaSala]);
            // Atualiza likes/favorito da nova sala (se logado com conta)
            if (contaAtiva) { pedirEstadoSala(); renderizarSocial(); }
        }
    } else if (estadoTransicao === "fade_in") {
        transicaoAlpha -= 0.05;
        if (transicaoAlpha <= 0) {
            transicaoAlpha = 0;
            estadoTransicao = "idle";
            portaPendente = null;
            // Puff de chegada no próprio teleporte (tela já limpa do fade)
            spawnFumaca(meuBicho.x + meuBicho.tamanho / 2, meuBicho.y + meuBicho.tamanho / 2);
        }
    }
}

// =====================================================
//   RENDERIZAÇÃO — helpers
// =====================================================
function desenharSpriteInvertido(img, x, y, tamanho, lado) {
    if (lado === "direita") {
        ctx.save(); ctx.translate(x + tamanho, y); ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, tamanho, tamanho); ctx.restore();
    } else {
        ctx.drawImage(img, x, y, tamanho, tamanho);
    }
}

// <-- SUBSTITUÍDA: versão com suporte a isDev
function desenharCrachaNome(nome, xCentro, yTopo, isDev = false) {
    ctx.font = "10px monospace";
    const textoCompleto = isDev ? `${nome} ★DEV` : nome;
    const lt = ctx.measureText(textoCompleto).width;
    const px = 6, lx = lt + px * 2, ay = 14;
    const xb = xCentro - lx / 2, yb = yTopo - ay - 2;
    ctx.fillStyle = "#161616"; ctx.fillRect(xb, yb, lx, ay);
    ctx.strokeStyle = isDev ? "#FFD24A" : "#FFFFFF";
    ctx.lineWidth = 1; ctx.strokeRect(xb, yb, lx, ay);
    if (isDev) {
        const ltNome = ctx.measureText(nome + " ").width;
        ctx.textAlign = "left";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(nome + " ", xb + px, yb + 11);
        ctx.fillStyle = "#FFD24A";
        ctx.fillText("★DEV", xb + px + ltNome, yb + 11);
    } else {
        ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.fillText(nome, xCentro, yb + 11);
    }
}

function desenharBalao(texto, xCentro, yTopo, ellipsis = false) {
    ctx.font = "9px monospace";
    const lt = ctx.measureText(texto).width;
    const pd = 6;
    const lb = ellipsis ? 22 : lt + pd * 2;
    const ab = 14;
    const xb = xCentro - lb / 2, yb = yTopo - ab - 24;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(xb, yb, lb, ab);
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.strokeRect(xb, yb, lb, ab);
    ctx.beginPath();
    ctx.moveTo(xCentro - 4, yb + ab);
    ctx.lineTo(xCentro + 4, yb + ab);
    ctx.lineTo(xCentro, yb + ab + 5);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000000"; ctx.textAlign = "center";
    ctx.filter = "grayscale(1)";
    ctx.fillText(texto, xCentro, yb + 10);
    ctx.filter = "none";
}

function desenharReguaDebug() {
    ctx.save();

    // Grid
    ctx.strokeStyle = "rgba(0,255,100,0.35)"; ctx.lineWidth = 0.5;
    ctx.font = "7px monospace"; ctx.fillStyle = "rgba(0,150,60,0.85)"; ctx.textAlign = "left";
    for (let x = 0; x <= canvas.width; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        ctx.fillText(x, x + 2, 10);
    }
    for (let y = 0; y <= canvas.height; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        ctx.fillText(y, 2, y + 8);
    }

    // Hitboxes das portas
    for (const p of (MAPAS[minhaSala]?.portas || [])) {
        ctx.strokeStyle = "#ff2255"; ctx.lineWidth = 1; ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "#ff2255"; ctx.fillText(`-> ${p.destino.toUpperCase()}`, p.x, p.y - 3);
    }

    // Cursor: crosshair + coordenadas
    ctx.strokeStyle = "rgba(255,255,0,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mouseX - 6, mouseY); ctx.lineTo(mouseX + 6, mouseY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouseX, mouseY - 6); ctx.lineTo(mouseX, mouseY + 6); ctx.stroke();

    const coordLabel = `x:${mouseX} y:${mouseY}`;
    const labelW = ctx.measureText(coordLabel).width + 8;
    const labelX = mouseX + 10;
    const labelY = mouseY - 4;
    ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(labelX, labelY - 9, labelW, 13);
    ctx.fillStyle = "#ffff00"; ctx.font = "8px monospace"; ctx.textAlign = "left";
    ctx.fillText(coordLabel, labelX + 4, labelY);

    ctx.restore();
}

function _desenharDebugOverlay() {
    // Painel de stats e log renderizado no <div id="debugOverlay">.
    // Fica fora do canvas (position:fixed), não tapa o jogo.
    const el = document.getElementById("debugOverlay");
    if (!el) return;
    const online = Object.keys(outrosJogadores).length + 1;
    const stats = [
        `sala:   ${minhaSala}`,
        `pos:    ${Math.floor(meuBicho.x + meuBicho.tamanho / 2)}, ${Math.floor(meuBicho.y + meuBicho.tamanho / 2)}`,
        `online: ${online}`,
        `ws:     ${ws?.readyState === WebSocket.OPEN ? "OK" : "OFF"}`,
        `wasm:   ${Wasm.ready ? "ON" : "fallback JS"}`,
        `mouse:  ${mouseX}, ${mouseY}`,
    ];
    const linhas = Math.min(debugLog.length, 12);
    const start  = debugLog.length - linhas;
    const eventos = Array.from({ length: linhas }, (_, i) => {
        const ev = debugLog[start + i];
        const cor = ev.categoria === "join"  ? "#88ff88"
                  : ev.categoria === "leave" ? "#ff8888"
                  : ev.categoria === "error" ? "#ff5555" : "#cccccc";
        let txt = `${ev.ts.slice(0,5)} ${ev.mensagem}`;
        if (txt.length > 32) txt = txt.slice(0, 30) + "\u2026";
        return `<div style="color:${cor}">${txt}</div>`;
    }).join("");
    el.innerHTML =
        `<div class="dbg-titulo">[F2] DEBUG</div>` +
        `<div class="dbg-stats">${stats.map(s => `<div>${s}</div>`).join("")}</div>` +
        `<div class="dbg-sep">\u2500 EVENTOS \u2500</div>` +
        `<div>${eventos}</div>`;
}

// =====================================================
//   RENDERIZAÇÃO — frame
// =====================================================
function desenhar() {
    ctx.save();

    if (tremorTela > 0) {
        ctx.translate((Math.random() - 0.5) * tremorTela, (Math.random() - 0.5) * tremorTela);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const salaAtual = MAPAS[minhaSala];
    const imgFundo = imagensCenarios[minhaSala];
    if (imgFundo?.complete && imgFundo.naturalWidth !== 0) {
        ctx.drawImage(imgFundo, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = salaAtual?.corFundo || "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.font = "10px monospace"; ctx.textAlign = "center";

    // Outros jogadores
    for (const id in outrosJogadores) {
        const p = outrosJogadores[id];
        // Interpolação suave em direção à última posição recebida do servidor.
        // Protege contra targetX/Y indefinidos (evita NaN).
        if (p.targetX === undefined) p.targetX = p.x;
        if (p.targetY === undefined) p.targetY = p.y;
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        // Se a distância for grande (jogador deu "tp" real, ex: mudou de sala),
        // snap direto em vez de deslizar lentamente.
        if (Math.abs(dx) > 80 || Math.abs(dy) > 80) {
            p.x = p.targetX; p.y = p.targetY;
        } else {
            p.x += dx * 0.25;
            p.y += dy * 0.25;
        }
        const bobeio = p.animTick > 0 ? Math.abs(Math.sin(p.animTick)) * -5 : 0;
        const img = imagensSprites[p.spriteId];
        if (img?.complete && img.naturalWidth !== 0) {
            desenharSpriteInvertido(img, p.x, p.y + bobeio, meuBicho.tamanho, p.lado);
        } else {
            ctx.fillStyle = "#888888"; ctx.fillRect(p.x, p.y + bobeio, meuBicho.tamanho, meuBicho.tamanho);
        }
        // <-- ADICIONADO: passa isDev para o crachá
        desenharCrachaNome(p.username, p.x + meuBicho.tamanho / 2, p.y - 5 + bobeio, !!p.isDev);
        if (p.chatTimer > 0) desenharBalao(p.chatTexto, p.x + meuBicho.tamanho / 2, p.y + bobeio);
        else if (p.isTyping) desenharBalao("...", p.x + meuBicho.tamanho / 2, p.y + bobeio, true);
    }

    // Meu jogador
    const bobeioMeu = meuBicho.animTick > 0 ? Math.abs(Math.sin(meuBicho.animTick)) * -5 : 0;
    const imgMeu = imagensSprites[meuBicho.spriteId];
    if (imgMeu?.complete && imgMeu.naturalWidth !== 0) {
        desenharSpriteInvertido(imgMeu, meuBicho.x, meuBicho.y + bobeioMeu, meuBicho.tamanho, meuBicho.lado);
    } else {
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(meuBicho.x, meuBicho.y + bobeioMeu, meuBicho.tamanho, meuBicho.tamanho);
    }
    // <-- ADICIONADO: passa isDev para o crachá do próprio jogador
    desenharCrachaNome(meuBicho.username, meuBicho.x + meuBicho.tamanho / 2, meuBicho.y - 5 + bobeioMeu, !!meuBicho.isDev);
    if (meuBicho.chatTimer > 0) {
        desenharBalao(meuBicho.chatTexto, meuBicho.x + meuBicho.tamanho / 2, meuBicho.y + bobeioMeu);
    } else if (document.activeElement === chatInput) {
        desenharBalao("...", meuBicho.x + meuBicho.tamanho / 2, meuBicho.y + bobeioMeu, true);
    }

    // Legenda do nome da sala (entrada/transição)
    if (legendaTimer > 0) {
        const alpha = Math.min(1, legendaTimer / 30);
        const nomeSala = salaAtual?.nome || "";
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        const lw = ctx.measureText(nomeSala).width;
        ctx.fillStyle = "#000000";
        ctx.fillRect(canvas.width / 2 - lw / 2 - 8, 8, lw + 16, 20);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
        ctx.strokeRect(canvas.width / 2 - lw / 2 - 8, 8, lw + 16, 20);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(nomeSala, canvas.width / 2, 22);
        ctx.restore();
    }

    // Renderização da lógica da sala (overlays de minigame, museu, etc.)
    try {
        getLogica()?.render?.(ctx, meuBicho, outrosJogadores, imagensSprites, meuBicho.tamanho);
    } catch (e) {
        console.error(`[render:${minhaSala}]`, e);
    }

    // Expõe a flag pra plugins (sonhos_*.js usam window.SALA33_DEBUG)
    window.SALA33_DEBUG = mostrarDebug;

    if (mostrarDebug) {
        desenharReguaDebug();
        _desenharDebugOverlay();
    }
    // Mostra/esconde o painel HTML de debug
    const _dbgEl = document.getElementById("debugOverlay");
    if (_dbgEl) _dbgEl.classList.toggle("ativo", mostrarDebug);

    if (transicaoAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${transicaoAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // <-- ADICIONADO: desenha partículas de fumaça
    desenharFumacas();

    ctx.restore();
}

// =====================================================
//   LOOP PRINCIPAL
// =====================================================
function loop(timestamp) {
    requestAnimationFrame(loop);
    const delta = timestamp - tempoAnterior;
    if (delta >= intervaloFps) {
        tempoAnterior = timestamp - (delta % intervaloFps);
        atualizarFisica();
        desenhar();
    }
}

// =====================================================
//   BOOT
// =====================================================
window.addEventListener("DOMContentLoaded", inicializar);