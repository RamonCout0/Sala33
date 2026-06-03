const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let ws;

// ==========================================
// ESTADO LOCAL DO JOGADOR
// ==========================================
let minhaSala = "the_hub";
let meuBicho = { username: "", x: 200, y: 150, velocidade: 2, tamanho: 32, chatTexto: "", chatTimer: 0, isTyping: false, spriteId: "cinzaguy" }; 
let outrosJogadores = {}; 
let teclas = {}; 

let transicaoAlpha = 0;
let estadoTransicao = "idle"; 
let portaPendente = null;     
let legendaTimer = 0;         

let tempoAnterior = 0;
const intervaloFps = 1000 / 60; 

// CENTRAL DE ASSETS (32x32)
const PATHS_SPRITES = {
    "cinzaguy": "assets/cinzaguy.png",
    "bailarina": "assets/bailarina.png",
    "cat": "assets/cat.png",
    "dog": "assets/dog.png",
    "nututu": "assets/nututu.png"
};

const imagensSprites = {};
for (let id in PATHS_SPRITES) {
    imagensSprites[id] = new Image();
    imagensSprites[id].src = PATHS_SPRITES[id];
}

// GUARDA DE PERSISTÊNCIA
window.addEventListener('DOMContentLoaded', () => {
    const salvoUser = localStorage.getItem('sala33_username');
    const salvoSprite = localStorage.getItem('sala33_spriteId');
    
    if (salvoUser) document.getElementById('username').value = salvoUser;
    if (salvoSprite) document.getElementById('spriteSelect').value = salvoSprite;

    atualizarPreviewSkin();
});

function atualizarPreviewSkin() {
    const idSelecionado = document.getElementById('spriteSelect').value;
    const imgEl = document.getElementById('spritePreview');
    const fallbackEl = document.getElementById('fallbackText');
    
    imgEl.src = PATHS_SPRITES[idSelecionado];
    
    imgEl.onload = function() {
        imgEl.style.display = "block";
        fallbackEl.style.display = "none";
    };
    
    imgEl.onerror = function() {
        imgEl.style.display = "none";
        fallbackEl.style.display = "block";
        fallbackEl.innerText = "S/ SKIN";
    };
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

// REDE DE TELEPORTES
const MAPAS = {
    "the_hub": {
        nome: "THE HUB", corFundo: "#2a2a2a", imagemPath: "assets/the_hub.png", 
        portas: [
            { destino: "sala_jogos", x: 0, y: 130, w: 20, h: 40, spawnX: 330, spawnY: 134 }, 
            { destino: "museu", x: 380, y: 130, w: 20, h: 40, spawnX: 30, spawnY: 134 },    
            { destino: "floresta", x: 180, y: 0, w: 40, h: 20, spawnX: 184, spawnY: 230 },  
            { destino: "o_quarto", x: 180, y: 280, w: 40, h: 20, spawnX: 184, spawnY: 30 }  
        ]
    },
    "sala_jogos": { nome: "SALA DE JOGOS", corFundo: "#444444", imagemPath: "assets/mapa_sala_jogos.png", portas: [{ destino: "the_hub", x: 380, y: 130, w: 20, h: 40, spawnX: 30, spawnY: 134 }] },
    "museu": { nome: "MUSEU", corFundo: "#111111", imagemPath: "assets/mapa_museu.png", portas: [{ destino: "the_hub", x: 0, y: 130, w: 20, h: 40, spawnX: 330, spawnY: 134 }] },
    "floresta": { nome: "FLORESTA", corFundo: "#1a1a1a", imagemPath: "assets/mapa_floresta.png", portas: [{ destino: "the_hub", x: 180, y: 280, w: 40, h: 20, spawnX: 184, spawnY: 30 }] },
    "o_quarto": { nome: "O QUARTO", corFundo: "#050505", imagemPath: "assets/mapa_o_quarto.png", portas: [{ destino: "the_hub", x: 180, y: 0, w: 40, h: 20, spawnX: 184, spawnY: 230 }] }
};

const imagensCenarios = {};
for (let nomeSala in MAPAS) {
    imagensCenarios[nomeSala] = new Image();
    imagensCenarios[nomeSala].src = MAPAS[nomeSala].imagemPath;
}

// ==========================================
// REDE E CONEXÃO WEBSOCKET
// ==========================================
function conectar() {
    const user = document.getElementById('username').value;
    const skinEscolhida = document.getElementById('spriteSelect').value;
    if (!user) return alert("Digite um nome!");
    
    meuBicho.username = user.toUpperCase().strip ? user.toUpperCase().strip() : user.toUpperCase();
    meuBicho.spriteId = skinEscolhida;

    document.getElementById('menu').style.display = 'none';
    document.getElementById('gameUI').style.display = 'flex';

    ws = new WebSocket('ws://' + window.location.hostname + ':8080');

    ws.onopen = () => {
        ws.send(JSON.stringify({ tipo: 'login', username: meuBicho.username, spriteId: meuBicho.spriteId }));
        legendaTimer = 180; 
        requestAnimationFrame(loop);
    };

    ws.onmessage = (event) => {
        const dados = JSON.parse(event.data);
        const chatBox = document.getElementById('chatBox');

        // GATILHO INTERCEPTADOR DE CLONES
        if (dados.tipo === "erro_login") {
            alert(dados.mensagem);
            ws.close(); // Aborta a conexão pendente no Python
            document.getElementById('menu').style.display = 'block';
            document.getElementById('gameUI').style.display = 'none';
            return;
        }

        if (dados.tipo === "novo_jogador") {
            if (dados.username !== meuBicho.username) {
                dados.chatTexto = ""; dados.chatTimer = 0; dados.isTyping = false;
                outrosJogadores[dados.id] = dados;
            }
            chatBox.innerHTML += `<div class="sistema">» ${dados.username} se conectou à rede.</div>`;
        } 
        else if (dados.tipo === "lista_jogadores") {
            dados.jogadores.forEach(p => {
                if (p.username !== meuBicho.username) {
                    p.chatTexto = ""; p.chatTimer = 0; p.isTyping = false;
                    outrosJogadores[p.id] = p;
                }
            });
        }
        else if (dados.tipo === "movimento") {
            if (outrosJogadores[dados.id]) {
                outrosJogadores[dados.id].x = dados.x;
                outrosJogadores[dados.id].y = dados.y;
            }
        } 
        else if (dados.tipo === "jogador_saiu") {
            if (outrosJogadores[dados.id]) {
                chatBox.innerHTML += `<div class="sistema">« ${outrosJogadores[dados.id].username} desconectou.</div>`;
                delete outrosJogadores[dados.id];
            }
        }
        else if (dados.tipo === "chat") {
            chatBox.innerHTML += `<div><strong>[${dados.username}]:</strong> ${dados.texto}</div>`;

            if (dados.username === meuBicho.username) {
                meuBicho.chatTexto = dados.texto; meuBicho.chatTimer = 240;
            } else {
                for (let id in outrosJogadores) {
                    if (outrosJogadores[id].username === dados.username) {
                        outrosJogadores[id].chatTexto = dados.texto; outrosJogadores[id].chatTimer = 240;
                        break;
                    }
                }
            }
        }
        else if (dados.tipo === "jogador_digitando") {
            if (outrosJogadores[dados.id]) {
                outrosJogadores[dados.id].isTyping = dados.estado;
            }
        }
        
        chatBox.scrollTop = chatBox.scrollHeight; 
    };
}

// ==========================================
// CONTROLES E INPUTS
// ==========================================
const chatInput = document.getElementById('chatInput');

chatInput.addEventListener('focus', () => { if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: true })); });
chatInput.addEventListener('blur', () => { if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: false })); });
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        let textoTraduzido = traduzirEmotes(chatInput.value);
        ws.send(JSON.stringify({ tipo: 'chat', texto: textoTraduzido }));
        chatInput.value = '';
        chatInput.blur(); 
    }
});

window.addEventListener('keydown', (e) => { if (document.activeElement !== chatInput) teclas[e.key] = true; });
window.addEventListener('keyup', (e) => teclas[e.key] = false);

function atualizarFisica() {
    if (estadoTransicao !== "idle") { targetFade(); return; }

    let dx = 0; let dy = 0;
    if (teclas['ArrowUp'] || teclas['w']) dy -= 1;
    if (teclas['ArrowDown'] || teclas['s']) dy += 1;
    if (teclas['ArrowLeft'] || teclas['a']) dx -= 1;
    if (teclas['ArrowRight'] || teclas['d']) dx += 1;

    if (dx !== 0 || dy !== 0) {
        let atualVelocidade = meuBicho.velocidade;
        if (dx !== 0 && dy !== 0) atualVelocidade = atualVelocidade * 0.7071;
        meuBicho.x += dx * atualVelocidade;
        meuBicho.y += dy * atualVelocidade;
        if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'mover', x: meuBicho.x, y: meuBicho.y }));
    }

    meuBicho.x = Math.max(0, Math.min(400 - meuBicho.tamanho, meuBicho.x));
    meuBicho.y = Math.max(0, Math.min(300 - meuBicho.tamanho, meuBicho.y));

    const salaAtual = MAPAS[minhaSala];
    salaAtual.portas.forEach(porta => {
        if (meuBicho.x < porta.x + porta.w && meuBicho.x + meuBicho.tamanho > porta.x &&
            meuBicho.y < porta.y + porta.h && meuBicho.y + meuBicho.tamanho > porta.y) {
            if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: false })); 
            estadoTransicao = "fade_out";
            portaPendente = porta;
        }
    });

    if (meuBicho.chatTimer > 0) meuBicho.chatTimer--;
    for (let id in outrosJogadores) { if (outrosJogadores[id].chatTimer > 0) outrosJogadores[id].chatTimer--; }
    if (legendaTimer > 0) legendaTimer--;
}

function targetFade() {
    if (estadoTransicao === "fade_out") {
        transicaoAlpha += 0.05; 
        if (transicaoAlpha >= 1) {
            transicaoAlpha = 1;
            minhaSala = portaPendente.destino;
            meuBicho.x = portaPendente.spawnX; meuBicho.y = portaPendente.spawnY;
            outrosJogadores = {}; legendaTimer = 180; estadoTransicao = "fade_in";
            if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: "mudar_sala", nova_sala: portaPendente.destino, x: portaPendente.spawnX, y: portaPendente.spawnY }));
        }
    } else if (estadoTransicao === "fade_in") {
        transicaoAlpha -= 0.05; 
        if (transicaoAlpha <= 0) { transicaoAlpha = 0; estadoTransicao = "idle"; portaPendente = null; }
    }
}

// ==========================================
// RENDERIZADORES
// ==========================================
function desenharBalao(texto, xCentro, yTopoBoneco, estiloIndicador = false) {
    ctx.font = "9px monospace";
    let larguraTexto = ctx.measureText(texto).width;
    let padding = 6; let larguraBox = larguraTexto + padding * 2; let alturaBox = 14;
    let xBox = xCentro - larguraBox / 2; let yBox = yTopoBoneco - alturaBox - 12;

    if(estiloIndicador) { larguraBox = 22; xBox = xCentro - larguraBox / 2; }

    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(xBox, yBox, larguraBox, alturaBox);
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.strokeRect(xBox, yBox, larguraBox, alturaBox);

    ctx.beginPath(); ctx.moveTo(xCentro - 4, yBox + alturaBox); ctx.lineTo(xCentro + 4, yBox + alturaBox); ctx.lineTo(xCentro, yBox + alturaBox + 4); ctx.closePath();
    ctx.fillStyle = "#FFFFFF"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.fillText(texto, xCentro, yBox + 10);
}

function desenharLegenda() {
    if (legendaTimer <= 0) return;
    ctx.save(); if (legendaTimer < 30) ctx.globalAlpha = legendaTimer / 30;
    ctx.fillStyle = "rgba(18, 18, 18, 0.85)"; ctx.fillRect(100, 15, 200, 24);
    ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(100, 15, 200, 24);
    ctx.fillStyle = "#FFFFFF"; ctx.font = "11px monospace"; ctx.textAlign = "center"; ctx.fillText(MAPAS[minhaSala].nome, 200, 31);
    ctx.restore();
}

function desenhar() {
    const salaAtual = MAPAS[minhaSala];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    
    const imgFundo = imagensCenarios[minhaSala];
    if (imgFundo && imgFundo.complete && imgFundo.naturalWidth !== 0) {
        ctx.drawImage(imgFundo, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = salaAtual.corFundo; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = "rgba(85, 85, 85, 0.6)"; salaAtual.portas.forEach(porta => ctx.fillRect(porta.x, porta.y, porta.w, porta.h));
    ctx.font = "10px monospace"; ctx.textAlign = "center";

    // RENDER OUTROS PLAYERS
    for (let id in outrosJogadores) {
        let p = outrosJogadores[id];
        let imgSpriteOutro = imagensSprites[p.spriteId];

        if (imgSpriteOutro && imgSpriteOutro.complete && imgSpriteOutro.naturalWidth !== 0) {
            ctx.drawImage(imgSpriteOutro, p.x, p.y, meuBicho.tamanho, meuBicho.tamanho);
        } else {
            ctx.fillStyle = "#888888"; ctx.fillRect(p.x, p.y, meuBicho.tamanho, meuBicho.tamanho);
        }
        
        ctx.fillStyle = "white"; ctx.fillText(p.username, p.x + (meuBicho.tamanho/2), p.y - 5);
        if (p.chatTimer > 0) desenharBalao(p.chatTexto, p.x + (meuBicho.tamanho/2), p.y);
        else if (p.isTyping) desenharBalao("...", p.x + (meuBicho.tamanho/2), p.y, true);
    }

    // RENDER SEU BICHO
    let imgMeuSprite = imagensSprites[meuBicho.spriteId];
    if (imgMeuSprite && imgMeuSprite.complete && imgMeuSprite.naturalWidth !== 0) {
        ctx.drawImage(imgMeuSprite, meuBicho.x, meuBicho.y, meuBicho.tamanho, meuBicho.tamanho);
    } else {
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(meuBicho.x, meuBicho.y, meuBicho.tamanho, meuBicho.tamanho);
    }
    
    ctx.fillStyle = "white"; ctx.fillText(meuBicho.username, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y - 5);
    if (meuBicho.chatTimer > 0) desenharBalao(meuBicho.chatTexto, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y);
    else if (document.activeElement === chatInput) desenharBalao("...", meuBicho.x + (meuBicho.tamanho/2), meuBicho.y, true);

    desenharLegenda();
    if (transicaoAlpha > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${transicaoAlpha})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

function enviarEmoteDirect(emoteTexto) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'chat', texto: emoteTexto }));
}

function loop(timestamp) {
    requestAnimationFrame(loop);
    const tempoDecorrido = timestamp - tempoAnterior;
    if (tempoDecorrido >= intervaloFps) {
        tempoAnterior = timestamp - (tempoDecorrido % intervaloFps);
        atualizarFisica();
        desenhar();
    }
}