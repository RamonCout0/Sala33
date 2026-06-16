// =====================================================
//   SALA 33 — ENGINE CORE
//   Carrega mapas, personagens e lógicas dinamicamente
//   a partir de public/mods/.
// =====================================================

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
//   WASM — Physics Engine
//   Carrega public/wasm/physics.wasm e expõe:
//     Wasm.update_particles(ptr, count, dt)
//     Wasm.lerp_positions(src, dst, out, n, t)
//     Wasm.check_rect_overlap(...)
//     Wasm.snow_update(ptr, count, speed_mult, w, h)
// =====================================================
const Wasm = {
    ready: false,
    _inst: null,
    _mem: null,
    // Buffers alocados dentro da memória do módulo
    _ptrs: {},

    async init() {
        try {
            const res = await fetch('wasm/physics.wasm');
            const buf = await res.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(buf, {
                env: { memory: new WebAssembly.Memory({ initial: 4 }) }
            });
            this._inst = instance.exports;
            this._mem  = instance.exports.memory;
            this.ready = true;
            console.log('[WASM] physics.wasm carregado ✓');
        } catch (e) {
            console.warn('[WASM] Não foi possível carregar physics.wasm, usando fallback JS:', e.message);
        }
    },

    _alloc(floats) {
        // Retorna um ponteiro pra um bloco de floats na memória do WASM
        // Simplificado: usa o heap base do módulo
        return 0; // será expandido quando necessário
    },

    // Chama update_particles no WASM ou faz fallback JS
    updateParticles(arr, dt) {
        if (!this.ready || arr.length === 0) return arr;
        // Cria Float32Array view na memória do WASM
        const count = arr.length;
        const mem   = new Float32Array(this._mem.buffer, 0, count * 8);
        for (let i = 0; i < count; i++) {
            const p = arr[i], base = i * 8;
            mem[base]   = p.x;    mem[base+1] = p.y;
            mem[base+2] = p.vx;   mem[base+3] = p.vy;
            mem[base+4] = p.vida; mem[base+5] = p.decay;
            mem[base+6] = p.tam;
            // flags: bit0=ativo, bit1=tem_gravidade, bit2=tem_drift
            let flags = 1; // sempre ativo
            if (p.gravidade) flags |= 2;
            if (p.drift)     flags |= 4;
            mem[base+7] = flags;
        }
        this._inst.update_particles(0, count, dt);
        // Lê de volta
        for (let i = 0; i < count; i++) {
            const p = arr[i], base = i * 8;
            p.x    = mem[base];   p.y    = mem[base+1];
            p.vx   = mem[base+2]; p.vy   = mem[base+3];
            p.vida = mem[base+4]; p.tam  = mem[base+6];
        }
        return arr.filter(p => p.vida > 0);
    },

    // Colisão rect-rect (WASM ou fallback)
    checkRectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
        if (this.ready) {
            return this._inst.check_rect_overlap(ax,ay,aw,ah,bx,by,bw,bh) === 1;
        }
        return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
    },

    // Ponto em rect (WASM ou fallback)
    checkPointInRect(px, py, rx, ry, rw, rh) {
        if (this.ready) {
            return this._inst.check_point_in_rect(px,py,rx,ry,rw,rh) === 1;
        }
        return px >= rx && px <= rx+rw && py >= ry && py <= ry+rh;
    },
};

// =====================================================
//   CONFIG DINÂMICA (carregada de JSON)
// =====================================================
let MAPAS = {};
let PATHS_SPRITES = {};
let AUDIO_PATHS = {};
let SALA_INICIAL = "the_hub";

// =====================================================
//   ÁUDIO (lazy load)
// =====================================================
let volumeGeral = 0.5;
const audios = {};
let audioTocando = null;

function precarregarAudios() {
    // No mobile não faz preload — evita lag e throttling do browser
    if ("ontouchstart" in window) return;
    for (const id in AUDIO_PATHS) {
        if (!audios[id]) {
            audios[id] = new Audio(AUDIO_PATHS[id]);
            audios[id].loop = true;
            audios[id].volume = volumeGeral;
            audios[id].preload = "auto";
        }
    }
}

// Retoma música quando o usuário volta à aba (mobile pausa áudio em background)
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && audioTocando) {
        audioTocando.play().catch(() => {});
    }
});

function tocarMusica(id) {
    if (!AUDIO_PATHS[id]) return;
    if (!audios[id]) {
        audios[id] = new Audio(AUDIO_PATHS[id]);
        audios[id].loop = true;
        audios[id].volume = volumeGeral;
    }
    if (audioTocando === audios[id]) return;
    if (audioTocando) { audioTocando.pause(); audioTocando.currentTime = 0; }
    audioTocando = audios[id];
    audioTocando.volume = volumeGeral;
    audioTocando.play().catch(() => { /* aguarda clique do usuário */ });
}

function ajustarVolume(v) {
    volumeGeral = Math.max(0, Math.min(1, parseFloat(v)));
    for (const id in audios) audios[id].volume = volumeGeral;
}
window.ajustarVolume = ajustarVolume;

// =====================================================
//   IMAGENS
// =====================================================
const imagensSprites = {};
const imagensCenarios = {};

function carregarImagens() {
    for (const id in PATHS_SPRITES) {
        imagensSprites[id] = new Image();
        imagensSprites[id].src = PATHS_SPRITES[id];
    }
    for (const nomeSala in MAPAS) {
        imagensCenarios[nomeSala] = new Image();
        imagensCenarios[nomeSala].src = MAPAS[nomeSala].imagemPath;
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

// =====================================================
//   RELÓGIO BRT + PAINEL DE EMOJIS
// =====================================================
const EMOJIS_PAINEL = [
    "😊", "😢", "😂", "😅", "😐", "😡",
    "💀", "🔥", "👑", "🏆", "😎", "🤓",
    "❤️", "💔", "👍", "👎", "🤝", "✌️",
    "😱", "🤔", "😴", "👀", "🫡", "😏",
    "☕", "🌙", "⭐", "🎠", "🎢", "💫",
];

function horaAtualBrasil() {
    return new Date().toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit", minute: "2-digit",
    });
}

function _aplicarGrayscaleEmojis(el) {
    if (!el) return;
    el.querySelectorAll("img.emoji").forEach(img => {
        img.style.cssText += "; filter: grayscale(100%) brightness(0.8) !important; width: 1em; height: 1em; vertical-align: -0.15em;";
    });
}

function inicializarPainelEmojis() {
    const painel = document.getElementById("emojiPanel");
    if (!painel) return;
    const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/";
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

function togglePainelEmoji() {
    document.getElementById("emojiPanel")?.classList.toggle("aberto");
}
window.togglePainelEmoji = togglePainelEmoji;

document.addEventListener("click", (e) => {
    const container = document.getElementById("emojiBarContainer");
    if (container && !container.contains(e.target))
        document.getElementById("emojiPanel")?.classList.remove("aberto");
});

setInterval(() => {
    const el = document.getElementById("relogioChat");
    if (el) el.textContent = "// " + horaAtualBrasil() + " BRT";
}, 1000);

// =====================================================
//   SAFE DOM — previne XSS
// =====================================================
function appendChatMsg(className, textos) {
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
        twemoji.parse(div, {
            base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/",
            folder: "72x72", ext: ".png"
        });
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
function atualizarPreviewSkin() {
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

function traduzirEmotes(texto) {
    return texto
        .replace(/:\)/g, "(•‿•)")
        .replace(/:\(/g, "(╥﹏╥)")
        .replace(/<3/g, "(❤️)")
        .replace(/:[oO]/g, "(o_O)")
        .replace(/:[dD]/g, "(≧◡≦)")
        .replace(/;\)/g, "(━╤┳━)");
}

function enviarEmote(emote) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "chat", texto: emote }));
        meuBicho.chatTexto = emote;
        meuBicho.chatTimer = 240;
    }
}
window.enviarEmote = enviarEmote;

// =====================================================
//   AUTENTICAÇÃO / CONTAS
//   Abas no menu: convidado | entrar | criar conta.
//   Auth acontece via WebSocket (registrar / autenticar).
// =====================================================
let modoAuth = "convidado";          // convidado | entrar | criar | esqueci
let tokenConta = null;               // JWT salvo após login/registro
let wsAuth = null;                   // socket temporário só pra auth

function _authMsg(texto, tipo) {
    const el = document.getElementById("authMsg");
    if (!el) return;
    el.textContent = texto;
    el.className = tipo || "";
    if (!texto) el.className = "";
}

function trocarAba(modo) {
    modoAuth = modo;
    _authMsg("", "");
    document.querySelectorAll(".auth-tab").forEach(t => {
        t.classList.toggle("ativa", t.dataset.modo === modo);
    });
    const contaFields = document.getElementById("contaFields");
    const guestField  = document.getElementById("username");
    const seletorSkin = document.querySelector(".selector-container");
    const emailField  = document.getElementById("contaEmail");
    const linkEsqueci = document.getElementById("linkEsqueciSenha");
    const resetFields = document.getElementById("resetFields");
    const btn         = document.getElementById("btnEntrar");

    contaFields.style.display = "none";
    guestField.style.display  = "none";
    if (seletorSkin) seletorSkin.style.display = "none";
    if (emailField)  emailField.style.display  = "none";
    if (linkEsqueci) linkEsqueci.style.display = "none";
    if (resetFields) resetFields.style.display = "none";

    if (modo === "convidado") {
        guestField.style.display = "block";
        if (seletorSkin) seletorSkin.style.display = "flex";
        btn.textContent = "ENTRAR";
    } else if (modo === "entrar") {
        contaFields.style.display = "block";
        if (linkEsqueci) linkEsqueci.style.display = "block";
        btn.textContent = "ENTRAR COM CONTA";
    } else if (modo === "criar") {
        contaFields.style.display = "block";
        if (emailField) emailField.style.display = "block";
        if (seletorSkin) seletorSkin.style.display = "flex";
        btn.textContent = "CRIAR E ENTRAR";
    } else if (modo === "esqueci") {
        if (resetFields) resetFields.style.display = "block";
        btn.textContent = "ENVIAR RECUPERAÇÃO";
    }
}
window.trocarAba = trocarAba;

// URL do WebSocket (mesma lógica usada no jogo)
function _wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1"
        || location.hostname.startsWith("192.168.") || location.hostname.startsWith("10.");
    return isLocal ? `ws://${location.hostname}:8080` : `${proto}//${location.host}`;
}

// Roteador do botão ENTRAR conforme a aba ativa
function acaoMenu() {
    if (modoAuth === "convidado") {
        conectar();
    } else if (modoAuth === "entrar" || modoAuth === "criar") {
        autenticarOuCriar(modoAuth === "criar" ? "registrar" : "autenticar");
    } else if (modoAuth === "esqueci") {
        solicitarReset();
    }
}
window.acaoMenu = acaoMenu;

// Abre um socket dedicado de auth e manda uma mensagem, tratando a resposta.
// cb(dados) decide o que fazer com cada resposta.
function _authSocket(payload, onResp) {
    const sock = new WebSocket(_wsUrl());
    sock.onopen = () => sock.send(JSON.stringify(payload));
    sock.onmessage = (event) => {
        let dados;
        try { dados = JSON.parse(event.data); } catch { return; }
        onResp(dados, sock);
    };
    sock.onerror = () => onResp({ tipo: "_erro_conexao" }, sock);
    return sock;
}

// Solicita recuperação de senha (resposta sempre neutra)
function solicitarReset() {
    const username = document.getElementById("resetUser").value.trim().toUpperCase();
    if (username.length < 3) return _authMsg("Digite seu usuário.", "erro");
    const btn = document.getElementById("btnEntrar");
    btn.disabled = true; btn.textContent = "ENVIANDO...";
    _authSocket({ tipo: "solicitar_reset", username }, (dados, sock) => {
        if (dados.tipo === "reset_solicitado") {
            _authMsg(dados.mensagem || "Se a conta existir, enviamos instruções.", "ok");
            sock.close();
            btn.disabled = false; btn.textContent = "ENVIAR RECUPERAÇÃO";
        } else if (dados.tipo === "_erro_conexao") {
            _authMsg("Erro de conexão.", "erro");
            btn.disabled = false; btn.textContent = "ENVIAR RECUPERAÇÃO";
        }
    });
}
window.solicitarReset = solicitarReset;

// Faz registro OU login via WebSocket dedicado, salva token e entra no jogo
function autenticarOuCriar(tipo) {
    const username = document.getElementById("contaUser").value.trim().toUpperCase();
    const password = document.getElementById("contaPass").value;
    const email = (document.getElementById("contaEmail")?.value || "").trim();
    if (username.length < 3) return _authMsg("Usuário precisa de 3+ caracteres.", "erro");
    if (password.length < 6) return _authMsg("Senha precisa de 6+ caracteres.", "erro");
    if (!Object.keys(MAPAS).length) return _authMsg("Configs carregando, aguarde...", "erro");

    const btn = document.getElementById("btnEntrar");
    btn.disabled = true;
    btn.textContent = tipo === "registrar" ? "CRIANDO..." : "ENTRANDO...";
    _authMsg("", "");

    // Payload: inclui email só no registro (e só se preenchido)
    const payload = { tipo, username, password };
    if (tipo === "registrar" && email) payload.email = email;

    // Abre um socket dedicado só pra auth
    wsAuth = new WebSocket(_wsUrl());

    wsAuth.onopen = () => {
        wsAuth.send(JSON.stringify(payload));
    };

    wsAuth.onmessage = (event) => {
        let dados;
        try { dados = JSON.parse(event.data); } catch { return; }

        if (dados.tipo === "auth_ok") {
            tokenConta = dados.token;
            localStorage.setItem("sala33_token", tokenConta);
            meuBicho.username = dados.user.username;
            meuBicho.spriteId = dados.user.sprite_id || "cinzaguy";
            meuBicho.isDev = !!dados.user.isDev;  // <-- ADICIONADO: recebe flag isDev do servidor
            meuUserId = dados.user.id;
            meuBio = dados.user.bio || "";
            wsAuth.close(); wsAuth = null;
            btn.disabled = false;
            // Entra no jogo usando o token
            conectar({ token: tokenConta });
        }
        else if (dados.tipo === "auth_erro") {
            _authMsg(dados.mensagem || "Falha na autenticação.", "erro");
            wsAuth.close(); wsAuth = null;
            btn.disabled = false;
            btn.textContent = tipo === "registrar" ? "CRIAR E ENTRAR" : "ENTRAR COM CONTA";
        }
    };

    wsAuth.onerror = () => {
        _authMsg("Erro de conexão com o servidor.", "erro");
        btn.disabled = false;
        btn.textContent = tipo === "registrar" ? "CRIAR E ENTRAR" : "ENTRAR COM CONTA";
    };
}
window.autenticarOuCriar = autenticarOuCriar;

// =====================================================
//   PAINEL SOCIAL (amigos + favoritos + pedidos + PV)
// =====================================================
let contaAtiva = false;            // logado com conta?
let meuUserId = null;              // meu id de usuário (conta)
let meuBio = "";                   // bio do perfil
let meusAmigos = [];               // [{id, username, sprite_id}]
let meusFavoritos = [];            // ["the_hub", ...]
let meusPedidos = [];              // pedidos recebidos [{id, username, sprite_id}]
let amigosOnline = new Set();      // ids de amigos online agora
let likesSala = {};                // { room_id: {total, curtiu} }

// Estado do chat privado
let pvAtual = null;                // {id, username} do amigo com quem converso
const pvHistorico = {};            // { friendId: [ {de, texto, ts, eu} ] }

function toggleSocial() {
    const painel = document.getElementById("socialPanel");
    if (!painel) return;
    painel.classList.toggle("aberto");
    if (painel.classList.contains("aberto")) {
        // Pede lista atualizada ao abrir (traz status online + pedidos)
        if (ws?.readyState === WebSocket.OPEN && contaAtiva) {
            ws.send(JSON.stringify({ tipo: "listar_amigos" }));
        }
        renderizarSocial();
    }
}
window.toggleSocial = toggleSocial;

function _socialMsg(texto, tipo) {
    const el = document.getElementById("socialMsg");
    if (!el) return;
    el.textContent = texto;
    el.className = tipo || "";
    if (texto) setTimeout(() => { el.textContent = ""; el.className = ""; }, 4000);
}

function adicionarAmigo() {
    const input = document.getElementById("inputAddAmigo");
    const nome = input.value.trim().toUpperCase();
    if (!nome) return;
    if (nome === meuBicho.username) return _socialMsg("Você não pode se adicionar.", "erro");
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "add_amigo", username: nome }));
        input.value = "";
    }
}
window.adicionarAmigo = adicionarAmigo;

function aceitarPedido(fromId) {
    if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ tipo: "aceitar_pedido", from_id: fromId }));
}
window.aceitarPedido = aceitarPedido;

function recusarPedido(fromId) {
    if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ tipo: "recusar_pedido", from_id: fromId }));
    // Remove localmente na hora
    meusPedidos = meusPedidos.filter(p => p.id !== fromId);
    renderizarSocial();
}
window.recusarPedido = recusarPedido;

function removerAmigo(friendId) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "remover_amigo", friend_id: friendId }));
    }
}
window.removerAmigo = removerAmigo;

function tpAmigo(friendId) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "tp_amigo", friend_id: friendId }));
    }
}
window.tpAmigo = tpAmigo;

function toggleFavoritoSalaAtual() {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "toggle_favorito", room_id: minhaSala }));
    }
}
window.toggleFavoritoSalaAtual = toggleFavoritoSalaAtual;

function toggleLikeSalaAtual() {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "toggle_like", room_id: minhaSala }));
    }
}
window.toggleLikeSalaAtual = toggleLikeSalaAtual;

// =====================================================
//   PAINEL DE PERFIL
// =====================================================
let _perfilAberto = false;

function _perfilMsg(texto, tipo) {
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
    sel.value = meuBicho.spriteId || "cinzaguy";
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

function togglePerfil() {
    const overlay = document.getElementById("perfilOverlay");
    const painel  = document.getElementById("perfilPanel");
    if (!painel) return;
    _perfilAberto = !_perfilAberto;
    if (_perfilAberto) {
        // Popula campos com dados atuais
        const nomeEl = document.getElementById("perfilUsername");
        if (nomeEl) nomeEl.textContent = meuBicho.username || "";
        const bioEl = document.getElementById("perfilBio");
        if (bioEl) bioEl.value = meuBio || "";
        _popularSpritesPerfil();
        // Sincroniza sprite selecionado com o atual
        const sel = document.getElementById("perfilSpriteSelect");
        if (sel) { sel.value = meuBicho.spriteId || "cinzaguy"; _atualizarPreviewPerfil(); }
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

function fecharPerfilOverlay(e) {
    if (e.target === document.getElementById("perfilOverlay")) togglePerfil();
}
window.fecharPerfilOverlay = fecharPerfilOverlay;

function salvarPerfil() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return _perfilMsg("Sem conexão.", "erro");
    const sprite = document.getElementById("perfilSpriteSelect")?.value;
    const bio    = document.getElementById("perfilBio")?.value || "";
    const btn    = document.getElementById("btnSalvarPerfil");
    if (btn) { btn.disabled = true; btn.textContent = "SALVANDO..."; }
    ws.send(JSON.stringify({ tipo: "atualizar_perfil", sprite_id: sprite, bio: bio.trim() }));
}
window.salvarPerfil = salvarPerfil;

function trocarSenhaPerfil() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return _perfilMsg("Sem conexão.", "erro");
    const senhaAtual   = document.getElementById("perfilSenhaAtual")?.value || "";
    const novaSenha    = document.getElementById("perfilNovaSenha")?.value || "";
    const confirmar    = document.getElementById("perfilConfirmarSenha")?.value || "";
    if (!senhaAtual) return _perfilMsg("Digite a senha atual.", "erro");
    if (novaSenha.length < 6) return _perfilMsg("Nova senha precisa de 6+ caracteres.", "erro");
    if (novaSenha !== confirmar) return _perfilMsg("As senhas não coincidem.", "erro");
    const btn = document.getElementById("btnTrocarSenha");
    if (btn) { btn.disabled = true; btn.textContent = "ALTERANDO..."; }
    ws.send(JSON.stringify({ tipo: "trocar_senha", senha_atual: senhaAtual, nova_senha: novaSenha }));
}
window.trocarSenhaPerfil = trocarSenhaPerfil;

// Pede ao servidor o estado de likes da sala atual (total + se eu curti)
function pedirEstadoSala() {
    if (ws?.readyState === WebSocket.OPEN && minhaSala) {
        ws.send(JSON.stringify({ tipo: "estado_sala", room_id: minhaSala }));
    }
}

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

// ---------- PARTÍCULAS DE FUMAÇA (efeito de chegada por TP) ----------
// Renderizadas no canvas. Cada nuvem é uma lista de partículas cinza
// que sobem, expandem e somem — estilo "puff" de teleporte.
let fumacas = [];   // [{x, y, vx, vy, vida, vidaMax, tam}]

function spawnFumaca(cx, cy) {
    // cx, cy = centro do jogador que chegou
    const N = 14;
    for (let i = 0; i < N; i++) {
        const ang = (Math.PI * 2 * i) / N + Math.random() * 0.5;
        const vel = 0.3 + Math.random() * 0.8;
        fumacas.push({
            x: cx + (Math.random() - 0.5) * 10,
            y: cy + (Math.random() - 0.5) * 10,
            vx: Math.cos(ang) * vel,
            vy: Math.sin(ang) * vel - 0.4,   // tendência a subir
            vida: 1.0,
            vidaMax: 1.0,
            decay: 0.012 + Math.random() * 0.012,
            tam: 5 + Math.random() * 7,
        });
    }
    if (fumacas.length > 200) fumacas = fumacas.slice(-200);   // teto de segurança
}

function atualizarFumacas() {
    for (const f of fumacas) {
        f.x += f.vx;
        f.y += f.vy;
        f.vy += 0.005;           // leve gravidade que desacelera a subida
        f.vx *= 0.96;            // arrasto
        f.tam += 0.35;           // expande
        f.vida -= f.decay;
    }
    fumacas = fumacas.filter(f => f.vida > 0);
}

function desenharFumacas() {
    if (!fumacas.length) return;
    ctx.save();
    for (const f of fumacas) {
        const alpha = Math.max(0, f.vida) * 0.5;
        const tom = 150 + Math.floor((1 - f.vida) * 60);   // clareia ao sumir
        ctx.fillStyle = `rgba(${tom},${tom},${tom},${alpha})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.tam, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Amigo online: ou está na lista de amigosOnline (servidor) ou na minha sala
function _amigoEstaOnline(amigo) {
    if (amigosOnline.has(amigo.id)) return true;
    for (const id in outrosJogadores) {
        if (outrosJogadores[id].username === amigo.username) return true;
    }
    return false;
}

// ---------- CHAT PRIVADO (PV) ----------
function abrirPV(friendId, friendName) {
    pvAtual = { id: friendId, username: friendName };
    if (!pvHistorico[friendId]) pvHistorico[friendId] = [];
    const painel = document.getElementById("pvPanel");
    const titulo = document.getElementById("pvTitulo");
    if (titulo) titulo.textContent = `// PV: ${friendName}`;
    if (painel) painel.classList.add("aberto");
    renderizarPV();
    setTimeout(() => document.getElementById("pvInput")?.focus(), 80);
}
window.abrirPV = abrirPV;

function fecharPV() {
    document.getElementById("pvPanel")?.classList.remove("aberto");
    pvAtual = null;
}
window.fecharPV = fecharPV;

function enviarPV() {
    const input = document.getElementById("pvInput");
    if (!input || !pvAtual) return;
    const texto = input.value.trim();
    if (!texto) return;
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "pv", friend_id: pvAtual.id, texto: traduzirEmotes(texto) }));
        input.value = "";
    }
}
window.enviarPV = enviarPV;

function _registrarPV(friendId, de, texto, eu) {
    if (!pvHistorico[friendId]) pvHistorico[friendId] = [];
    pvHistorico[friendId].push({ de, texto, ts: horaAtualBrasil(), eu });
    if (pvHistorico[friendId].length > 100) pvHistorico[friendId].shift();
    // Se o PV está aberto com esse amigo, re-renderiza
    if (pvAtual && pvAtual.id === friendId) renderizarPV();
}

function renderizarPV() {
    const box = document.getElementById("pvBox");
    if (!box || !pvAtual) return;
    const hist = pvHistorico[pvAtual.id] || [];
    box.innerHTML = "";
    if (hist.length === 0) {
        const vazio = document.createElement("div");
        vazio.className = "pv-sistema";
        vazio.textContent = `Início da conversa com ${pvAtual.username}.`;
        box.appendChild(vazio);
    } else {
        hist.forEach(m => {
            const div = document.createElement("div");
            div.className = "pv-msg" + (m.eu ? " eu" : "");
            const hora = document.createElement("span");
            hora.className = "pv-hora";
            hora.textContent = m.ts;
            const de = document.createElement("span");
            de.className = "pv-de";
            de.textContent = (m.eu ? "você" : m.de) + ": ";
            div.appendChild(hora);
            div.appendChild(de);
            div.appendChild(document.createTextNode(m.texto));
            if (window.twemoji) {
                twemoji.parse(div, { base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/", folder: "72x72", ext: ".png" });
                _aplicarGrayscaleEmojis(div);
            }
            box.appendChild(div);
        });
    }
    box.scrollTop = box.scrollHeight;
}

function renderizarSocial() {
    // Botão de favoritar reflete o estado da sala atual
    const btnFav = document.getElementById("btnFavSala");
    if (btnFav) {
        const favoritada = meusFavoritos.includes(minhaSala);
        btnFav.classList.toggle("ativo", favoritada);
        btnFav.textContent = favoritada
            ? `★ SALA FAVORITADA (${minhaSala})`
            : `☆ FAVORITAR ESTA SALA`;
    }

    // Botão de like reflete total + se eu curti
    const btnLike = document.getElementById("btnLikeSala");
    const likeCount = document.getElementById("likeCount");
    if (btnLike) {
        const info = likesSala[minhaSala] || { total: 0, curtiu: false };
        if (likeCount) likeCount.textContent = info.total;
        btnLike.classList.toggle("ativo", !!info.curtiu);
        // ♥ cheio se curti, ♡ vazio se não
        btnLike.innerHTML = (info.curtiu ? "♥" : "♡") + ` <span id="likeCount">${info.total}</span> LIKES`;
    }

    // Pedidos de amizade recebidos
    const secaoPedidos = document.getElementById("secaoPedidos");
    const listaPedidos = document.getElementById("listaPedidos");
    const pedidosCount = document.getElementById("pedidosCount");
    if (pedidosCount) pedidosCount.textContent = meusPedidos.length;
    if (secaoPedidos) secaoPedidos.style.display = meusPedidos.length > 0 ? "block" : "none";
    if (listaPedidos) {
        listaPedidos.innerHTML = "";
        meusPedidos.forEach(p => {
            const item = document.createElement("div");
            item.className = "pedido-item";
            const nome = document.createElement("span");
            nome.textContent = p.username;
            const acoes = document.createElement("div");
            acoes.className = "pedido-acoes";
            const aceitar = document.createElement("button");
            aceitar.className = "pedido-btn pedido-aceitar";
            aceitar.textContent = "✓";
            aceitar.title = "Aceitar";
            aceitar.onclick = () => aceitarPedido(p.id);
            const recusar = document.createElement("button");
            recusar.className = "pedido-btn pedido-recusar";
            recusar.textContent = "×";
            recusar.title = "Recusar";
            recusar.onclick = () => recusarPedido(p.id);
            acoes.appendChild(aceitar);
            acoes.appendChild(recusar);
            item.appendChild(nome);
            item.appendChild(acoes);
            listaPedidos.appendChild(item);
        });
    }

    // Lista de amigos
    const lista = document.getElementById("listaAmigos");
    const count = document.getElementById("amigosCount");
    if (count) count.textContent = meusAmigos.length;
    if (lista) {
        if (meusAmigos.length === 0) {
            lista.innerHTML = `<div class="social-vazio">Nenhum amigo ainda.</div>`;
        } else {
            lista.innerHTML = "";
            meusAmigos.forEach(a => {
                const online = _amigoEstaOnline(a);
                const item = document.createElement("div");
                item.className = "amigo-item";

                const nome = document.createElement("div");
                nome.className = "nome";
                const dot = document.createElement("span");
                dot.className = online ? "amigo-online" : "amigo-offline";
                nome.appendChild(dot);
                nome.appendChild(document.createTextNode(a.username));

                const acoes = document.createElement("div");
                acoes.className = "amigo-acoes";

                // Botão TP (só ativo se online)
                const btnTp = document.createElement("button");
                btnTp.className = "amigo-btn-tp";
                btnTp.textContent = "TP";
                btnTp.title = online ? `Teleportar até ${a.username}` : "Amigo offline";
                btnTp.disabled = !online;
                btnTp.onclick = () => tpAmigo(a.id);

                // Botão PV
                const btnPv = document.createElement("button");
                btnPv.className = "amigo-btn-pv";
                btnPv.textContent = "PV";
                btnPv.title = `Conversar com ${a.username}`;
                btnPv.onclick = () => abrirPV(a.id, a.username);

                // Botão remover
                const btnRm = document.createElement("button");
                btnRm.className = "social-btn-acao remove";
                btnRm.textContent = "×";
                btnRm.title = "Remover amigo";
                btnRm.onclick = () => removerAmigo(a.id);

                acoes.appendChild(btnTp);
                acoes.appendChild(btnPv);
                acoes.appendChild(btnRm);
                item.appendChild(nome);
                item.appendChild(acoes);
                lista.appendChild(item);
            });
        }
    }

    // Lista de favoritos
    const favBox = document.getElementById("listaFavoritos");
    if (favBox) {
        if (meusFavoritos.length === 0) {
            favBox.innerHTML = `<div class="social-vazio">Nenhuma sala favoritada.</div>`;
        } else {
            favBox.innerHTML = "";
            meusFavoritos.forEach(room => {
                const nomeSala = MAPAS[room]?.nome || room;
                const item = document.createElement("div");
                item.className = "fav-item";
                const nome = document.createElement("div");
                nome.className = "nome";
                nome.textContent = `★ ${nomeSala}`;
                const btn = document.createElement("button");
                btn.className = "social-btn-acao remove";
                btn.textContent = "×";
                btn.title = "Desfavoritar";
                btn.onclick = () => {
                    if (ws?.readyState === WebSocket.OPEN)
                        ws.send(JSON.stringify({ tipo: "toggle_favorito", room_id: room }));
                };
                item.appendChild(nome);
                item.appendChild(btn);
                favBox.appendChild(item);
            });
        }
    }
}

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
                meusAmigos = dados.amigos || [];
                meusFavoritos = dados.favoritos || [];
                meusPedidos = dados.pedidos || [];
                amigosOnline = new Set(dados.online || []);
                const btnSocial = document.getElementById("btnSocialToggle");
                if (btnSocial) btnSocial.style.display = "block";
                const btnPerfil = document.getElementById("btnPerfilToggle");
                if (btnPerfil) btnPerfil.style.display = "block";
                // Avisa se houver pedidos pendentes
                if (meusPedidos.length > 0) {
                    registrarDebug("info", `» ${meusPedidos.length} pedido(s) de amizade.`);
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
            meusAmigos = dados.lista || [];
            if (dados.online) amigosOnline = new Set(dados.online);
            if (dados.pedidos) meusPedidos = dados.pedidos;
            renderizarSocial();
        }
        else if (dados.tipo === "pedido_recebido") {
            // Alguém me mandou pedido enquanto estou online
            const de = dados.de;
            if (de && !meusPedidos.some(p => p.id === de.id)) {
                meusPedidos.push(de);
            }
            appendChatMsg("sistema", [{text: `» ${de.username} quer ser seu amigo! Abra o painel ★ AMIGOS.`}]);
            registrarDebug("info", `» Pedido de amizade de ${de.username}.`);
            renderizarSocial();
        }
        else if (dados.tipo === "pedido_enviado") {
            _socialMsg(dados.mensagem || "Pedido enviado.", "ok");
        }
        else if (dados.tipo === "pedido_recusado") {
            meusPedidos = meusPedidos.filter(p => p.id !== dados.from_id);
            renderizarSocial();
        }
        else if (dados.tipo === "amigo_erro") {
            _socialMsg(dados.mensagem || "Não foi possível.", "erro");
        }
        else if (dados.tipo === "favorito_estado") {
            if (dados.favoritado === true) {
                if (!meusFavoritos.includes(dados.room_id)) meusFavoritos.push(dados.room_id);
                _socialMsg(`Sala favoritada!`, "ok");
            } else if (dados.favoritado === false) {
                meusFavoritos = meusFavoritos.filter(r => r !== dados.room_id);
                _socialMsg(`Sala removida dos favoritos.`, "ok");
            }
            renderizarSocial();
        }
        else if (dados.tipo === "like_estado") {
            likesSala[dados.room_id] = {
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
                if (!pvAtual || pvAtual.id !== friendId) {
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
    // Enter pra focar no chat quando não está digitando
    if (e.code === "Enter" && document.activeElement !== chatInput) {
        e.preventDefault();
        chatInput.focus();
        return;
    }
    if (document.activeElement === chatInput) return;
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