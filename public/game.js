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
let meuBicho = {
    username: "", x: 200, y: 150, velocidade: 2, tamanho: 32,
    chatTexto: "", chatTimer: 0, isTyping: false,
    spriteId: "cinzaguy", lado: "direita", animTick: 0,
};
let outrosJogadores = {};
let teclas = {};

let transicaoAlpha = 0;
let estadoTransicao = "idle";
let portaPendente = null;
let legendaTimer = 0;

let tempoAnterior = 0;
const intervaloFps = 1000 / 60;

let mostrarDebug = false;
let tremorTela = 0;
let mouseX = 0, mouseY = 0;

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

        // 5. Imagens
        minhaSala = SALA_INICIAL;
        carregarImagens();

        btn.disabled = false;
        btn.textContent = "ENTRAR";
    } catch (e) {
        console.error("Erro ao carregar configs:", e);
        btn.textContent = "ERRO — VEJA O CONSOLE";
    }
}

// =====================================================
//   UI HELPERS
// =====================================================
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
//   CONEXÃO WEBSOCKET
// =====================================================
function conectar() {
    const user = document.getElementById("username").value;
    const skin = document.getElementById("spriteSelect").value;
    if (!user) return alert("Digite um nome!");
    if (!Object.keys(MAPAS).length) return alert("Configs ainda não carregaram. Recarregue a página.");

    meuBicho.username = user.toUpperCase().trim();
    meuBicho.spriteId = skin;
    localStorage.setItem("sala33_username", meuBicho.username);
    localStorage.setItem("sala33_spriteId", skin);

    document.getElementById("menu").style.display = "none";
    document.getElementById("gameUI").style.display = "flex";

    tocarMusica(SALA_INICIAL);

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");

    ws.onopen = () => {
        ws.send(JSON.stringify({
            tipo: "login",
            username: meuBicho.username,
            spriteId: meuBicho.spriteId,
            lado: meuBicho.lado,
        }));
        legendaTimer = 180;
        // Notifica a lógica da sala inicial
        getLogica()?.onEnter?.(MAPAS[minhaSala]);
        requestAnimationFrame(loop);
    };

    ws.onmessage = (event) => {
        const dados = JSON.parse(event.data);
        const chatBox = document.getElementById("chatBox");

        if (dados.tipo === "erro_login") {
            alert(dados.mensagem);
            ws.close();
            document.getElementById("menu").style.display = "block";
            document.getElementById("gameUI").style.display = "none";
            return;
        }

        if (dados.tipo === "novo_jogador") {
            if (dados.username !== meuBicho.username) {
                dados.chatTexto = ""; dados.chatTimer = 0; dados.isTyping = false;
                dados.lado = dados.lado || "direita";
                dados.animTick = 0; dados.movimentoTimer = 0;
                outrosJogadores[dados.id] = dados;
            }
            chatBox.innerHTML += `<div class="sistema">» ${dados.username} entrou.</div>`;
        }
        else if (dados.tipo === "lista_jogadores") {
            dados.jogadores.forEach(p => {
                if (p.username !== meuBicho.username) {
                    p.chatTexto = ""; p.chatTimer = 0; p.isTyping = false;
                    p.lado = p.lado || "direita";
                    p.animTick = 0; p.movimentoTimer = 0;
                    outrosJogadores[p.id] = p;
                }
            });
        }
        else if (dados.tipo === "movimento") {
            if (outrosJogadores[dados.id]) {
                if (dados.x > outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "direita";
                else if (dados.x < outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "esquerda";
                outrosJogadores[dados.id].x = dados.x;
                outrosJogadores[dados.id].y = dados.y;
                outrosJogadores[dados.id].movimentoTimer = 6;
            }
        }
        else if (dados.tipo === "jogador_saiu") {
            if (outrosJogadores[dados.id]) {
                chatBox.innerHTML += `<div class="sistema">« ${outrosJogadores[dados.id].username} saiu.</div>`;
                delete outrosJogadores[dados.id];
            }
        }
        else if (dados.tipo === "chat") {
            chatBox.innerHTML += `<div><strong>[${dados.username}]:</strong> ${dados.texto}</div>`;
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

        chatBox.scrollTop = chatBox.scrollHeight;
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

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    mouseY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
});

window.addEventListener("keydown", (e) => {
    if (document.activeElement === chatInput) return;
    teclas[e.code] = true;

    if (e.code === "F2") { e.preventDefault(); mostrarDebug = !mostrarDebug; return; }
    if (e.code === "F1") {
        e.preventDefault();
        const cm = document.getElementById("configMenu");
        cm.style.display = (cm.style.display === "none" || !cm.style.display) ? "block" : "none";
        return;
    }

    // Repassa para a lógica da sala
    if (ws?.readyState === WebSocket.OPEN) {
        const consumido = getLogica()?.onTeclaDown?.(e.code, ws, meuBicho);
        if (consumido) e.preventDefault();
    }
});
window.addEventListener("keyup", (e) => { teclas[e.code] = false; });
window.addEventListener("blur", () => { teclas = {}; meuBicho.animTick = 0; });

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
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ tipo: "mover", x: meuBicho.x, y: meuBicho.y, lado: meuBicho.lado }));
            }
        } else {
            meuBicho.animTick = 0;
        }

        meuBicho.x = Math.max(0, Math.min(canvas.width - meuBicho.tamanho, meuBicho.x));
        meuBicho.y = Math.max(0, Math.min(canvas.height - meuBicho.tamanho, meuBicho.y));

        // Verifica portas
        for (const porta of (MAPAS[minhaSala]?.portas || [])) {
            if (meuBicho.x < porta.x + porta.w && meuBicho.x + meuBicho.tamanho > porta.x &&
                meuBicho.y < porta.y + porta.h && meuBicho.y + meuBicho.tamanho > porta.y) {
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

function desenharCrachaNome(nome, xCentro, yTopo) {
    ctx.font = "10px monospace";
    const lt = ctx.measureText(nome).width;
    const px = 6, lx = lt + px * 2, ay = 14;
    const xb = xCentro - lx / 2, yb = yTopo - ay - 2;
    ctx.fillStyle = "#161616"; ctx.fillRect(xb, yb, lx, ay);
    ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(xb, yb, lx, ay);
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.fillText(nome, xCentro, yb + 11);
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
    ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.fillText(texto, xCentro, yb + 10);
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
        const bobeio = p.animTick > 0 ? Math.abs(Math.sin(p.animTick)) * -5 : 0;
        const img = imagensSprites[p.spriteId];
        if (img?.complete && img.naturalWidth !== 0) {
            desenharSpriteInvertido(img, p.x, p.y + bobeio, meuBicho.tamanho, p.lado);
        } else {
            ctx.fillStyle = "#888888"; ctx.fillRect(p.x, p.y + bobeio, meuBicho.tamanho, meuBicho.tamanho);
        }
        desenharCrachaNome(p.username, p.x + meuBicho.tamanho / 2, p.y - 5 + bobeio);
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
    desenharCrachaNome(meuBicho.username, meuBicho.x + meuBicho.tamanho / 2, meuBicho.y - 5 + bobeioMeu);
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

    if (mostrarDebug) desenharReguaDebug();

    if (transicaoAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${transicaoAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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
