const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let ws;

// ==========================================
// ESTADO LOCAL DO JOGADOR
// ==========================================
let minhaSala = "the_hub";
// CORRIGIDO: velocidade com 'e' no final!
let meuBicho = { username: "", x: 200, y: 150, velocidade: 2, tamanho: 32, chatTexto: "", chatTimer: 0 }; 
let outrosJogadores = {}; 
let teclas = {}; 

// Variáveis de Qualidade de Vida (QoL)
let transicaoAlpha = 0;
let estadoTransicao = "idle"; // "idle", "fade_out", "fade_in"
let portaPendente = null;     
let legendaTimer = 0;         

// ==========================================
// REDE DE TELEPORTES
// ==========================================
const MAPAS = {
    "the_hub": {
        nome: "THE HUB",
        corFundo: "#2a2a2a", 
        imagemPath: "assets/the_hub.png", 
        portas: [
            { destino: "sala_jogos", x: 0, y: 130, w: 20, h: 40, spawnX: 330, spawnY: 134 }, 
            { destino: "museu", x: 380, y: 130, w: 20, h: 40, spawnX: 30, spawnY: 134 },    
            { destino: "floresta", x: 180, y: 0, w: 40, h: 20, spawnX: 184, spawnY: 230 },  
            { destino: "o_quarto", x: 180, y: 280, w: 40, h: 20, spawnX: 184, spawnY: 30 }  
        ]
    },
    "sala_jogos": { 
        nome: "SALA DE JOGOS",
        corFundo: "#444444",
        imagemPath: "assets/mapa_sala_jogos.png", 
        portas: [
            { destino: "the_hub", x: 380, y: 130, w: 20, h: 40, spawnX: 30, spawnY: 134 }
        ] 
    },
    "museu": { 
        nome: "MUSEU",
        corFundo: "#111111",
        imagemPath: "assets/mapa_museu.png", 
        portas: [
            { destino: "the_hub", x: 0, y: 130, w: 20, h: 40, spawnX: 330, spawnY: 134 }
        ] 
    },
    "floresta": { 
        nome: "FLORESTA",
        corFundo: "#1a1a1a",
        imagemPath: "assets/mapa_floresta.png", 
        portas: [
            { destino: "the_hub", x: 180, y: 280, w: 40, h: 20, spawnX: 184, spawnY: 30 }
        ] 
    },
    "o_quarto": { 
        nome: "O QUARTO",
        corFundo: "#050505",
        imagemPath: "assets/mapa_o_quarto.png", 
        portas: [
            { destino: "the_hub", x: 180, y: 0, w: 40, h: 20, spawnX: 184, spawnY: 230 }
        ] 
    }
};

// ==========================================
// SISTEMA DE CARREGAMENTO DE CENÁRIOS
// ==========================================
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
    if (!user) return alert("Digite um nome!");
    meuBicho.username = user;

    document.getElementById('menu').style.display = 'none';
    document.getElementById('gameUI').style.display = 'flex';

    ws = new WebSocket('ws://localhost:8080');

    ws.onopen = () => {
        ws.send(JSON.stringify({ tipo: 'login', username: user }));
        legendaTimer = 180; 
        requestAnimationFrame(loop);
    };

    ws.onmessage = (event) => {
        const dados = JSON.parse(event.data);
        const chatBox = document.getElementById('chatBox');

        // Ignora se o novo jogador mapeado for você mesmo para não criar clones cinzas
        if (dados.tipo === "novo_jogador") {
            if (dados.username !== meuBicho.username) {
                dados.chatTexto = "";
                dados.chatTimer = 0;
                outrosJogadores[dados.id] = dados;
            }
            chatBox.innerHTML += `<div class="sistema"> Anúncio: ${dados.username} entrou na sala.</div>`;
        } 
        else if (dados.tipo === "movimento") {
            if (outrosJogadores[dados.id]) {
                outrosJogadores[dados.id].x = dados.x;
                outrosJogadores[dados.id].y = dados.y;
            }
        } 
        else if (dados.tipo === "jogador_saiu") {
            if (outrosJogadores[dados.id]) {
                chatBox.innerHTML += `<div class="sistema">❌ ${outrosJogadores[dados.id].username} saiu da sala.</div>`;
                delete outrosJogadores[dados.id];
            }
        }
        else if (dados.tipo === "chat") {
            chatBox.innerHTML += `<div><strong>${dados.username}:</strong> ${dados.texto}</div>`;

            if (dados.username === meuBicho.username) {
                meuBicho.chatTexto = dados.texto;
                meuBicho.chatTimer = 240;
            } else {
                for (let id in outrosJogadores) {
                    if (outrosJogadores[id].username === dados.username) {
                        outrosJogadores[id].chatTexto = dados.texto;
                        outrosJogadores[id].chatTimer = 240;
                        break;
                    }
                }
            }
        }
        
        chatBox.scrollTop = chatBox.scrollHeight;
    };
}

// ==========================================
// CONTROLES E ENTRADA DE CHAT
// ==========================================
const chatInput = document.getElementById('chatInput');

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        ws.send(JSON.stringify({ tipo: 'chat', texto: chatInput.value }));
        chatInput.value = '';
        chatInput.blur(); 
    }
});

window.addEventListener('keydown', (e) => {
    if (document.activeElement !== chatInput) teclas[e.key] = true;
});
window.addEventListener('keyup', (e) => teclas[e.key] = false);

// ==========================================
// FÍSICA E ANIMAÇÕES DE TRANSIÇÃO
// ==========================================
function atualizarFisica() {
    if (estadoTransicao !== "idle") {
        processarFade();
        return;
    }

    let moveu = false;
    if (teclas['ArrowUp'] || teclas['w']) { meuBicho.y -= meuBicho.velocidade; moveu = true; }
    if (teclas['ArrowDown'] || teclas['s']) { meuBicho.y += meuBicho.velocidade; moveu = true; }
    if (teclas['ArrowLeft'] || teclas['a']) { meuBicho.x -= meuBicho.velocidade; moveu = true; }
    if (teclas['ArrowRight'] || teclas['d']) { meuBicho.x += meuBicho.velocidade; moveu = true; }

    meuBicho.x = Math.max(0, Math.min(400 - meuBicho.tamanho, meuBicho.x));
    meuBicho.y = Math.max(0, Math.min(300 - meuBicho.tamanho, meuBicho.y));

    const salaAtual = MAPAS[minhaSala];
    salaAtual.portas.forEach(porta => {
        if (meuBicho.x < porta.x + porta.w && meuBicho.x + meuBicho.tamanho > porta.x &&
            meuBicho.y < porta.y + porta.h && meuBicho.y + meuBicho.tamanho > porta.y) {
            
            estadoTransicao = "fade_out";
            portaPendente = porta;
        }
    });

    if (moveu) ws.send(JSON.stringify({ tipo: 'mover', x: meuBicho.x, y: meuBicho.y }));

    if (meuBicho.chatTimer > 0) meuBicho.chatTimer--;
    for (let id in outrosJogadores) {
        if (outrosJogadores[id].chatTimer > 0) outrosJogadores[id].chatTimer--;
    }
    
    if (legendaTimer > 0) legendaTimer--;
}

function processarFade() {
    if (estadoTransicao === "fade_out") {
        transicaoAlpha += 0.05; 
        if (transicaoAlpha >= 1) {
            transicaoAlpha = 1;
            
            minhaSala = portaPendente.destino;
            meuBicho.x = portaPendente.spawnX; 
            meuBicho.y = portaPendente.spawnY;
            outrosJogadores = {}; 
            
            legendaTimer = 180;
            estadoTransicao = "fade_in";
            ws.send(JSON.stringify({ tipo: "mudar_sala", nova_sala: portaPendente.destino }));
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

// ==========================================
// FUNÇÕES AUXILIARES DE RENDER
// ==========================================
function desenharBalao(texto, xCentro, yTopoBoneco) {
    ctx.font = "9px monospace";
    let larguraTexto = ctx.measureText(texto).width;
    let padding = 6;
    let larguraBox = larguraTexto + padding * 2;
    let alturaBox = 14;
    let xBox = xCentro - larguraBox / 2;
    let yBox = yTopoBoneco - alturaBox - 12;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(xBox, yBox, larguraBox, alturaBox);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(xBox, yBox, larguraBox, alturaBox);

    ctx.beginPath();
    ctx.moveTo(xCentro - 4, yBox + alturaBox);
    ctx.lineTo(xCentro + 4, yBox + alturaBox);
    ctx.lineTo(xCentro, yBox + alturaBox + 4);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.fillText(texto, xCentro, yBox + 10);
}

function desenharLegenda() {
    if (legendaTimer <= 0) return;

    ctx.save();
    if (legendaTimer < 30) ctx.globalAlpha = legendaTimer / 30;

    ctx.fillStyle = "rgba(18, 18, 18, 0.8)";
    ctx.fillRect(100, 15, 200, 24);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.strokeRect(100, 15, 200, 24);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(MAPAS[minhaSala].nome, 200, 31);
    
    ctx.restore();
}

// ==========================================
// RENDER GERAL
// ==========================================
function desenhar() {
    const salaAtual = MAPAS[minhaSala];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const imgFundo = imagensCenarios[minhaSala];
    if (imgFundo && imgFundo.complete && imgFundo.naturalWidth !== 0) {
        ctx.drawImage(imgFundo, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = salaAtual.corFundo;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = "rgba(85, 85, 85, 0.6)"; 
    salaAtual.portas.forEach(porta => ctx.fillRect(porta.x, porta.y, porta.w, porta.h));

    ctx.font = "10px monospace";
    ctx.textAlign = "center";

    // Render dos outros players
    for (let id in outrosJogadores) {
        let p = outrosJogadores[id];
        ctx.fillStyle = "#888888";
        ctx.fillRect(p.x, p.y, meuBicho.tamanho, meuBicho.tamanho);
        ctx.fillStyle = "white";
        ctx.fillText(p.username, p.x + (meuBicho.tamanho/2), p.y - 5);

        if (p.chatTimer > 0) {
            desenharBalao(p.chatTexto, p.x + (meuBicho.tamanho/2), p.y);
        }
    }

    // Render do seu bicho (Sempre Branco)
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(meuBicho.x, meuBicho.y, meuBicho.tamanho, meuBicho.tamanho);
    ctx.fillStyle = "white";
    ctx.fillText(meuBicho.username, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y - 5);

    if (meuBicho.chatTimer > 0) {
        desenharBalao(meuBicho.chatTexto, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y);
    }

    desenharLegenda();

    if (transicaoAlpha > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${transicaoAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function loop() {
    atualizarFisica();
    desenhar();
    requestAnimationFrame(loop);
}