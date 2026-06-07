const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let ws;

// ==========================================
// ESTADO LOCAL DO JOGADOR E MINIGAMES
// ==========================================
let minhaSala = "the_hub";
let meuBicho = { username: "", x: 200, y: 150, velocidade: 2, tamanho: 32, chatTexto: "", chatTimer: 0, isTyping: false, spriteId: "cinzaguy", lado: "direita", animTick: 0 }; 
let outrosJogadores = {}; 
let teclas = {}; 

let transicaoAlpha = 0;
let estadoTransicao = "idle"; 
let portaPendente = null;     
let legendaTimer = 0;         

let tempoAnterior = 0;
const intervaloFps = 1000 / 60; 

let mouseX = 0; let mouseY = 0; let mostrarDebug = false; 

// ZONEAMENTO DA SALA DE JOGOS REAL DA TUA ART
let mesaPong = { x: 180, y: 195, w: 130, h: 30 }; 
let mesaUno = { x: 260, y: 105, w: 50, h: 30 };                      
let mesaDomino = { x: 110, y: 55, w: 50, h: 30 };               

let jogandoPong = false;
let dadosPong = { p1_y: 60, p2_y: 60, bola_x: 100, bola_y: 75, p1_score: 0, p2_score: 0 };

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    mouseY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
});

const PATHS_SPRITES = { "cinzaguy": "assets/cinzaguy.png", "bailarina": "assets/bailarina.png", "cat": "assets/cat.png", "dog": "assets/dog.png", "nututu": "assets/nututu.png" };
const imagensSprites = {};
for (let id in PATHS_SPRITES) { imagensSprites[id] = new Image(); imagensSprites[id].src = PATHS_SPRITES[id]; }

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
    imgEl.onload = function() { imgEl.style.display = "block"; fallbackEl.style.display = "none"; };
    imgEl.onerror = function() { imgEl.style.display = "none"; fallbackEl.style.display = "block"; fallbackEl.innerText = "S/ SKIN"; };
}
window.atualizarPreviewSkin = atualizarPreviewSkin;

function traduzirEmotes(texto) {
    return texto.replace(/:\)/g, "(•‿•)").replace(/:\(/g, "(╥﹏╥)").replace(/<3/g, "(❤️)").replace(/:[oO]/g, "(o_O)").replace(/:[dD]/g, "(≧◡≦)").replace(/;\)/g, "(━╤┳━)");
}

const MAPAS = {
    "the_hub": {
        nome: "THE HUB", corFundo: "#2a2a2a", imagemPath: "assets/the_hub.png", 
        portas: [
            { destino: "sala_jogos", x: 0, y: 215, w: 26, h: 36, spawnX: 330, spawnY: 134 }, 
            { destino: "museu", x: 365, y: 100, w: 35, h: 130, spawnX: 30, spawnY: 134 },    
            { destino: "floresta", x: 35, y: 60, w: 60, h: 90, spawnX: 184, spawnY: 230 },  
            { destino: "o_quarto", x: 180, y: 292, w: 70, h: 8, spawnX: 184, spawnY: 40 }  
        ]
    },
    "sala_jogos": { nome: "SALA DE JOGOS", corFundo: "#444444", imagemPath: "assets/sala_jogos.png", portas: [{ destino: "the_hub", x: 380, y: 130, w: 20, h: 40, spawnX: 45, spawnY: 225 }] },
    "museu": { nome: "MUSEU", corFundo: "#111111", imagemPath: "assets/museu.png", portas: [{ destino: "the_hub", x: 0, y: 130, w: 20, h: 40, spawnX: 315, spawnY: 160 }] },
    "floresta": { nome: "FLORESTA", corFundo: "#1a1a1a", imagemPath: "assets/floresta.png", portas: [{ destino: "the_hub", x: 180, y: 280, w: 40, h: 20, spawnX: 110, spawnY: 145 }] },
    "o_quarto": { nome: "O QUARTO", corFundo: "#050505", imagemPath: "assets/o_quarto.png", portas: [{ destino: "the_hub", x: 180, y: 0, w: 40, h: 20, spawnX: 214, spawnY: 250 }] }
};

const imagensCenarios = {};
for (let nomeSala in MAPAS) { imagensCenarios[nomeSala] = new Image(); imagensCenarios[nomeSala].src = MAPAS[nomeSala].imagemPath; }

function conectar() {
    const user = document.getElementById('username').value;
    const skinEscolhida = document.getElementById('spriteSelect').value;
    if (!user) return alert("Digite um nome!");
    meuBicho.username = user.toUpperCase().trim();
    meuBicho.spriteId = skinEscolhida;
    localStorage.setItem('sala33_username', meuBicho.username);
    localStorage.setItem('sala33_spriteId', meuBicho.spriteId);
    document.getElementById('menu').style.display = 'none';
    document.getElementById('gameUI').style.display = 'flex';

    ws = new WebSocket('ws://' + window.location.hostname + ':8080');
    ws.onopen = () => { ws.send(JSON.stringify({ tipo: 'login', username: meuBicho.username, spriteId: meuBicho.spriteId, lado: meuBicho.lado })); legendaTimer = 180; requestAnimationFrame(loop); };

    ws.onmessage = (event) => {
        const dados = JSON.parse(event.data);
        const chatBox = document.getElementById('chatBox');
        if (dados.tipo === "erro_login") { alert(dados.mensagem); ws.close(); document.getElementById('menu').style.display = 'block'; document.getElementById('gameUI').style.display = 'none'; return; }

        if (dados.tipo === "novo_jogador") {
            if (dados.username !== meuBicho.username) { dados.chatTexto = ""; dados.chatTimer = 0; dados.isTyping = false; dados.lado = dados.lado || "direita"; dados.animTick = 0; dados.movimentoTimer = 0; outrosJogadores[dados.id] = dados; }
            chatBox.innerHTML += `<div class="sistema">» ${dados.username} entrou.</div>`;
        } 
        else if (dados.tipo === "lista_jogadores") {
            dados.jogadores.forEach(p => { if (p.username !== meuBicho.username) { p.chatTexto = ""; p.chatTimer = 0; p.isTyping = false; p.lado = p.lado || "direita"; p.animTick = 0; p.movimentoTimer = 0; outrosJogadores[p.id] = p; } });
        }
        else if (dados.tipo === "movimento") {
            if (outrosJogadores[dados.id]) {
                if (dados.x > outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "direita";
                else if (dados.x < outrosJogadores[dados.id].x) outrosJogadores[dados.id].lado = "esquerda";
                outrosJogadores[dados.id].x = dados.x; outrosJogadores[dados.id].y = dados.y; outrosJogadores[dados.id].movimentoTimer = 6; 
            }
        } 
        else if (dados.tipo === "atualizacao_pong") {
            dadosPong = dados.estado;
            jogandoPong = dados.voce_esta_jogando;
            
            // Sincroniza o boneco localmente para não sumir ao sentar
            if (dados.meu_x !== undefined) meuBicho.x = dados.meu_x;
            if (dados.meu_y !== undefined) meuBicho.y = dados.meu_y;
            if (dados.meu_lado !== undefined) meuBicho.lado = dados.meu_lado;
        }
        else if (dados.tipo === "jogador_saiu") {
            if (outrosJogadores[dados.id]) { chatBox.innerHTML += `<div class="sistema">« ${outrosJogadores[dados.id].username} saiu.</div>`; delete outrosJogadores[dados.id]; }
        }
        else if (dados.tipo === "chat") {
            chatBox.innerHTML += `<div><strong>[${dados.username}]:</strong> ${dados.texto}</div>`;
            if (dados.username === meuBicho.username) { meuBicho.chatTexto = dados.texto; meuBicho.chatTimer = 240; }
            else { for (let id in outrosJogadores) { if (outrosJogadores[id].username === dados.username) { outrosJogadores[id].chatTexto = dados.texto; outrosJogadores[id].chatTimer = 240; break; } } }
        }
        else if (dados.tipo === "jogador_digitando") { if (outrosJogadores[dados.id]) outrosJogadores[dados.id].isTyping = dados.estado; }
        chatBox.scrollTop = chatBox.scrollHeight; 
    };
}

const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('focus', () => { teclas = {}; if(meuBicho) meuBicho.animTick = 0; if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: true })); });
chatInput.addEventListener('blur', () => { if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: false })); });
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && chatInput.value.trim() !== '') { let tx = traduzirEmotes(chatInput.value); ws.send(JSON.stringify({ tipo: 'chat', texto: tx })); chatInput.value = ''; chatInput.blur(); } });

window.addEventListener('keydown', (e) => { 
    if (document.activeElement !== chatInput) {
        teclas[e.code] = true; 
        if (e.code === 'F2') { e.preventDefault(); mostrarDebug = !mostrarDebug; }
        
        if (e.code === 'KeyE' && minhaSala === "sala_jogos") {
            e.preventDefault();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ tipo: 'interagir_pong' }));
            }
        }
    }
});
window.addEventListener('keyup', (e) => { teclas[e.code] = false; });
window.addEventListener('blur', () => { teclas = {}; if(meuBicho) meuBicho.animTick = 0; });

function atualizarFisica() {
    if (estadoTransicao !== "idle") { targetFade(); return; }
    let dx = 0; let dy = 0;
    
    if (jogandoPong) {
        if (teclas['ArrowUp'] || teclas['KeyW']) { ws.send(JSON.stringify({ tipo: 'comando_pong', acao: 'subir' })); }
        if (teclas['ArrowDown'] || teclas['KeyS']) { ws.send(JSON.stringify({ tipo: 'comando_pong', acao: 'descer' })); }
        if (teclas['KeyQ']) { ws.send(JSON.stringify({ tipo: 'sair_pong' })); }
    } else {
        if (teclas['ArrowUp'] || teclas['KeyW']) dy -= 1;
        if (teclas['ArrowDown'] || teclas['KeyS']) dy += 1;
        if (teclas['ArrowLeft'] || teclas['KeyA']) { dx -= 1; meuBicho.lado = "esquerda"; }
        if (teclas['ArrowRight'] || teclas['KeyD']) { dx += 1; meuBicho.lado = "direita"; }
    }

    if (dx !== 0 || dy !== 0) {
        let av = meuBicho.velocidade; if (dx !== 0 && dy !== 0) av = av * 0.7071;
        meuBicho.x += dx * av; meuBicho.y += dy * av; meuBicho.animTick += 0.25;
        if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'mover', x: meuBicho.x, y: meuBicho.y, lado: meuBicho.lado }));
    } else { if (!jogandoPong) meuBicho.animTick = 0; }

    for (let id in outrosJogadores) { let p = outrosJogadores[id]; if (p.movimentoTimer > 0) { p.movimentoTimer--; p.animTick += 0.25; } else { p.animTick = 0; } }
    meuBicho.x = Math.max(0, Math.min(400 - meuBicho.tamanho, meuBicho.x)); meuBicho.y = Math.max(0, Math.min(300 - meuBicho.tamanho, meuBicho.y));

    MAPAS[minhaSala].portas.forEach(porta => {
        if (meuBicho.x < porta.x + porta.w && meuBicho.x + meuBicho.tamanho > porta.x && meuBicho.y < porta.y + porta.h && meuBicho.y + meuBicho.tamanho > porta.y) {
            if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'digitando', estado: false })); 
            estadoTransicao = "fade_out"; portaPendente = porta;
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
            transicaoAlpha = 1; minhaSala = portaPendente.destino; meuBicho.x = portaPendente.spawnX; meuBicho.y = portaPendente.spawnY;
            outrosJogadores = {}; legendaTimer = 180; estadoTransicao = "fade_in"; teclas = {}; jogandoPong = false;
            if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: "mudar_sala", nova_sala: portaPendente.destino, x: portaPendente.spawnX, y: portaPendente.spawnY, lado: meuBicho.lado }));
        }
    } else if (estadoTransicao === "fade_in") { transicaoAlpha -= 0.05; if (transicaoAlpha <= 0) { transicaoAlpha = 0; estadoTransicao = "idle"; portaPendente = null; } }
}

// ==========================================
// RENDERIZADORES COMPLEMENTARES
// ==========================================
function desenharSpriteInvertido(img, x, y, tamanho, lado) {
    if (lado === "direita") { ctx.save(); ctx.translate(x + tamanho, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, tamanho, tamanho); ctx.restore(); } else { ctx.drawImage(img, x, y, tamanho, tamanho); }
}

function desenharCrachaNome(nome, xCentro, yTopoBoneco) {
    ctx.font = "10px monospace"; let lt = ctx.measureText(nome).width;
    let px = 6; let lx = lt + px * 2; let ay = 14; let xb = xCentro - lx / 2; let yb = yTopoBoneco - ay - 2;
    ctx.fillStyle = "#161616"; ctx.fillRect(xb, yb, lx, ay); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(xb, yb, lx, ay);
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.fillText(nome, xCentro, yb + 11);
}

function desenharBalao(texto, xCentro, yTopoBoneco, est = false) {
    ctx.font = "9px monospace"; let lt = ctx.measureText(texto).width;
    let pd = 6; let lb = lt + pd * 2; let ab = 14; let xb = xCentro - lb / 2; let yb = yTopoBoneco - ab - 24;
    if(est) { lb = 22; xb = xCentro - lb / 2; }
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(xb, yb, lb, ab); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.strokeRect(xb, yb, lb, ab);
    ctx.beginPath(); ctx.moveTo(xCentro - 4, yb + ab); ctx.lineTo(xCentro + 4, yb + ab); ctx.lineTo(xCentro, yb + ab + 5); ctx.closePath(); ctx.fillStyle = "#FFFFFF"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.fillText(texto, xCentro, yb + 10);
}

function desenharObjetosSalaJogos() {
    if (mostrarDebug) {
        ctx.strokeStyle = "rgba(0, 255, 255, 0.5)"; ctx.lineWidth = 1;
        ctx.strokeRect(mesaDomino.x, mesaDomino.y, mesaDomino.w, mesaDomino.h);
        ctx.strokeRect(mesaUno.x, mesaUno.y, mesaUno.w, mesaUno.h);
        ctx.strokeRect(mesaPong.x, mesaPong.y, mesaPong.w, mesaPong.h);
    }

    if (!jogandoPong) {
        let cx = meuBicho.x + meuBicho.tamanho / 2; let cy = meuBicho.y + meuBicho.tamanho / 2;
        if (cx > mesaPong.x - 20 && cx < mesaPong.x + mesaPong.w + 20 && cy > mesaPong.y - 20 && cy < mesaPong.y + mesaPong.h + 20) {
            ctx.fillStyle = "#161616"; ctx.fillRect(mesaPong.x + (mesaPong.w/2) - 35, mesaPong.y - 22, 70, 14);
            ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(mesaPong.x + (mesaPong.w/2) - 35, mesaPong.y - 22, 70, 14);
            ctx.fillStyle = "#00ffcc"; ctx.font = "8px monospace"; ctx.textAlign = "center";
            ctx.fillText("[E] JOGAR PONG", mesaPong.x + (mesaPong.w/2), mesaPong.y - 12);
        }
    }

    if (jogandoPong) {
        let px = 100; let py = 40; let pw = 200; let ph = 140;
        ctx.fillStyle = "#000000"; ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw / 2, py + ph); ctx.stroke();
        ctx.setLineDash([]);

        let escX = pw / 200; let escY = ph / 150;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(px + 6 * escX, py + dadosPong.p1_y * escY, 4 * escX, 25 * escY); 
        ctx.fillRect(px + (200 - 10) * escX, py + dadosPong.p2_y * escY, 4 * escX, 25 * escY); 
        ctx.fillRect(px + dadosPong.bola_x * escX, py + dadosPong.bola_y * escY, 5 * escX, 5 * escY);   

        ctx.font = "16px monospace"; ctx.textAlign = "center";
        ctx.fillText(dadosPong.p1_score, px + (pw * 0.25), py + 25);
        ctx.fillText(dadosPong.p2_score, px + (pw * 0.75), py + 25);

        ctx.font = "9px monospace"; ctx.fillStyle = "#ff2255"; 
        ctx.fillText("[Q] LARGAR CONTROLE", 200, py + ph + 15);
    }
}

function desenharLegenda() {
    if (legendaTimer <= 0) return;
    ctx.save(); if (legendaTimer < 30) ctx.globalAlpha = legendaTimer / 30;
    ctx.fillStyle = "rgba(18, 18, 18, 0.85)"; ctx.fillRect(100, 15, 200, 24);
    ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(100, 15, 200, 24);
    ctx.fillStyle = "#FFFFFF"; ctx.font = "11px monospace"; ctx.textAlign = "center"; ctx.fillText(MAPAS[minhaSala].nome, 200, 31);
    ctx.restore();
}

function desenharReguaDebug() {
    ctx.save(); ctx.strokeStyle = "rgba(0, 255, 100, 0.35)"; ctx.lineWidth = 0.5; ctx.font = "7px monospace"; ctx.fillStyle = "rgba(0, 150, 60, 0.85)"; ctx.textAlign = "left";
    for (let x = 0; x <= canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); ctx.fillText(x, x + 2, 10); }
    for (let y = 0; y <= canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); ctx.fillText(y, 2, y + 8); }
    MAPAS[minhaSala].portas.forEach(p => { ctx.strokeStyle = "#ff2255"; ctx.lineWidth = 1; ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.fillStyle = "#ff2255"; ctx.fillText(`🚪->${p.destino.toUpperCase()}`, p.x, p.y - 3); });
    ctx.strokeStyle = "rgba(0, 255, 204, 0.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mouseX, 0); ctx.lineTo(mouseX, canvas.height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, mouseY); ctx.lineTo(canvas.width, mouseY); ctx.stroke();
    ctx.fillStyle = "#00ffcc"; ctx.font = "9px monospace"; ctx.fillText(`X:${mouseX} Y:${mouseY}`, mouseX + 5, mouseY - 5); ctx.restore();
}

function desenhar() {
    const salaAtual = MAPAS[minhaSala]; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false; ctx.mozImageSmoothingEnabled = false; ctx.webkitImageSmoothingEnabled = false;
    
    const imgFundo = imagensCenarios[minhaSala];
    if (imgFundo && imgFundo.complete && imgFundo.naturalWidth !== 0) ctx.drawImage(imgFundo, 0, 0, canvas.width, canvas.height);
    else { ctx.fillStyle = salaAtual.corFundo; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.font = "10px monospace"; ctx.textAlign = "center";

    if (minhaSala === "sala_jogos") { desenharObjetosSalaJogos(); }

    for (let id in outrosJogadores) {
        let p = outrosJogadores[id]; let imgSpriteOutro = imagensSprites[p.spriteId];
        let bobeioYOutro = (p.animTick > 0) ? Math.abs(Math.sin(p.animTick)) * -5 : 0;
        if (imgSpriteOutro && imgSpriteOutro.complete && imgSpriteOutro.naturalWidth !== 0) desenharSpriteInvertido(imgSpriteOutro, p.x, p.y + bobeioYOutro, meuBicho.tamanho, p.lado);
        else { ctx.fillStyle = "#888888"; ctx.fillRect(p.x, p.y + bobeioYOutro, meuBicho.tamanho, meuBicho.tamanho); }
        desenharCrachaNome(p.username, p.x + (meuBicho.tamanho/2), p.y - 5 + bobeioYOutro);
        if (p.chatTimer > 0) desenharBalao(p.chatTexto, p.x + (meuBicho.tamanho/2), p.y + bobeioYOutro);
        else if (p.isTyping) desenharBalao("...", p.x + (meuBicho.tamanho/2), p.y + bobeioYOutro, true);
    }

    // =====================================
    // RENDERIZA O SEU PRÓPRIO BONECO SEMPRE
    // =====================================
    let bobeioYMeu = (!jogandoPong && meuBicho.animTick > 0) ? Math.abs(Math.sin(meuBicho.animTick)) * -5 : 0;
    let imgMeuSprite = imagensSprites[meuBicho.spriteId];
    
    if (imgMeuSprite && imgMeuSprite.complete && imgMeuSprite.naturalWidth !== 0) {
        desenharSpriteInvertido(imgMeuSprite, meuBicho.x, meuBicho.y + bobeioYMeu, meuBicho.tamanho, meuBicho.lado);
    } else { 
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(meuBicho.x, meuBicho.y + bobeioYMeu, meuBicho.tamanho, meuBicho.tamanho); 
    }
    
    desenharCrachaNome(meuBicho.username, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y - 5 + bobeioYMeu);
    
    if (meuBicho.chatTimer > 0) {
        desenharBalao(meuBicho.chatTexto, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y + bobeioYMeu);
    } else if (document.activeElement === chatInput) {
        desenharBalao("...", meuBicho.x + (meuBicho.tamanho/2), meuBicho.y + bobeioYMeu, true);
    }

    desenharLegenda();
    if (mostrarDebug) { desenharReguaDebug(); }
    if (transicaoAlpha > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${transicaoAlpha})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

function loop(timestamp) { requestAnimationFrame(loop); const tempoDecorrido = timestamp - tempoAnterior; if (tempoDecorrido >= intervaloFps) { tempoAnterior = timestamp - (tempoDecorrido % intervaloFps); atualizarFisica(); desenhar(); } }