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

// ==========================================
// 🎶 SISTEMA DE ÁUDIO DINÂMICO
// Substitua pelos nomes exatos dos seus arquivos de música!
// ==========================================
// ==========================================
// 🎶 SISTEMA DE ÁUDIO COM VOLUME E PREVENÇÃO DE TRAVA
// ==========================================
let volumeGeral = 0.5; // De 0.0 a 1.0
const AUDIO_PATHS = {
    "the_hub": "assets/musica_hub.mp3",
    "sala_jogos": "assets/musica_jogos.mp3",
    "museu": "assets/musica_museu.mp3",
    "floresta": "assets/musica_floresta.mp3",
    "o_quarto": "assets/musica_quarto.mp3",
    "pong": "assets/musica_pong.mp3",
    "aura": "assets/musica_aura.mp3"
};

const audios = {};
for(let id in AUDIO_PATHS) {
    audios[id] = new Audio(AUDIO_PATHS[id]);
    audios[id].loop = true;
    audios[id].volume = volumeGeral; // Aplica o volume inicial
}
let audioTocando = null;

// Função de Troca Inteligente
function tocarMusica(id) {
    if (!audios[id]) return;
    if (audioTocando === audios[id]) return;
    
    // Fade Out rápido (opcional) e troca
    if (audioTocando) { audioTocando.pause(); audioTocando.currentTime = 0; }
    
    audioTocando = audios[id];
    audioTocando.volume = volumeGeral; // Garante o volume atual
    audioTocando.play().catch(e => console.log("Áudio bloqueado pelo navegador"));
}

// Função para aumentar/diminuir volume (Chame no console ou crie um menu)
function ajustarVolume(novoVolume) {
    volumeGeral = Math.max(0, Math.min(1, novoVolume));
    for(let id in audios) { audios[id].volume = volumeGeral; }
    console.log("Volume alterado para: " + volumeGeral);
}

// ==========================================
// DADOS DOS OBJETOS E ZONAS INTERATIVAS
// ==========================================
let mesaPong = { x: 180, y: 195, w: 130, h: 30 }; 
let jogandoPong = false;
let dadosPong = { p1_y: 60, p2_y: 60, bola_x: 100, bola_y: 75, p1_score: 0, p2_score: 0 };

const quadrosMuseu = [
    { id: "mercado", x: 45, y: 43, w: 60, h: 40, titulo: "MERCADO NOIR" },
    { id: "tarrasque", x: 164, y: 36, w: 60, h: 40, titulo: "O TARRASQUE" },
    { id: "bioform", x: 301, y: 37, w: 60, h: 40, titulo: "BIOFORM" }
];
let obraVisivel = null; 

let tvQuarto = { x: 195, y: 250, w: 40, h: 30 }; 
let jogandoAura = false;
let souP1Aura = false;
let dadosAura = { p1_poder: 0, p2_poder: 0, p1_sprite: "cinzaguy", p2_sprite: "cinzaguy" };
let tremorTela = 0;

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    mouseY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
});

const PATHS_SPRITES = { 
    "cinzaguy": "assets/cinzaguy.png", "bailarina": "assets/bailarina.png", "cat": "assets/cat.png", 
    "dog": "assets/dog.png", "nututu": "assets/nututu.png", "portalel": "assets/portalel.png", "iluminus": "assets/iluminus.png"    
};
const imagensSprites = {};
for (let id in PATHS_SPRITES) { imagensSprites[id] = new Image(); imagensSprites[id].src = PATHS_SPRITES[id]; }

const PATHS_OBRAS = { "mercado": "assets/mercado.png", "tarrasque": "assets/tarrasque.png", "bioform": "assets/bioform.png" };
const imagensObras = {};
for (let id in PATHS_OBRAS) { imagensObras[id] = new Image(); imagensObras[id].src = PATHS_OBRAS[id]; }

window.addEventListener('DOMContentLoaded', () => {
    const salvoUser = localStorage.getItem('sala33_username');
    const salvoSprite = localStorage.getItem('sala33_spriteId');
    if (salvoUser) document.getElementById('username').value = salvoUser;
    if (salvoSprite) document.getElementById('spriteSelect').value = salvoSprite;
    atualizarPreviewSkin();
});

function atualizarPreviewSkin() {
    const selectEl = document.getElementById('spriteSelect');
    if (!selectEl) return;
    const idSelecionado = selectEl.value;
    const imgEl = document.getElementById('spritePreview');
    const fallbackEl = document.getElementById('fallbackText');
    if (PATHS_SPRITES[idSelecionado]) {
        imgEl.src = PATHS_SPRITES[idSelecionado];
        imgEl.onload = function() { imgEl.style.display = "block"; fallbackEl.style.display = "none"; };
        imgEl.onerror = function() { imgEl.style.display = "none"; fallbackEl.style.display = "block"; fallbackEl.innerText = "ERRO NA IMG"; };
    } else {
        imgEl.style.display = "none"; fallbackEl.style.display = "block"; fallbackEl.innerText = "S/ SKIN";
    }
}
window.atualizarPreviewSkin = atualizarPreviewSkin;

function traduzirEmotes(texto) { return texto.replace(/:\)/g, "(•‿•)").replace(/:\(/g, "(╥﹏╥)").replace(/<3/g, "(❤️)").replace(/:[oO]/g, "(o_O)").replace(/:[dD]/g, "(≧◡≦)").replace(/;\)/g, "(━╤┳━)"); }

const MAPAS = {
    "the_hub": { nome: "THE HUB", corFundo: "#2a2a2a", imagemPath: "assets/the_hub.png", portas: [ { destino: "sala_jogos", x: 0, y: 215, w: 26, h: 36, spawnX: 330, spawnY: 134 }, { destino: "museu", x: 365, y: 100, w: 35, h: 130, spawnX: 30, spawnY: 134 }, { destino: "floresta", x: 35, y: 60, w: 60, h: 90, spawnX: 184, spawnY: 230 }, { destino: "o_quarto", x: 180, y: 292, w: 70, h: 8, spawnX: 184, spawnY: 40 } ] },
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
    
    // Toca a música da sala inicial assim que conecta
    tocarMusica(minhaSala);

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
            
            // Transição de Áudio do Pong
            if (!jogandoPong && dados.voce_esta_jogando) tocarMusica("pong");
            if (jogandoPong && !dados.voce_esta_jogando) tocarMusica(minhaSala);
            
            jogandoPong = dados.voce_esta_jogando;
            
            if (dados.meu_x !== undefined) meuBicho.x = dados.meu_x; if (dados.meu_y !== undefined) meuBicho.y = dados.meu_y; if (dados.meu_lado !== undefined) meuBicho.lado = dados.meu_lado;
        }
        else if (dados.tipo === "atualizacao_aura") {
            dadosAura = dados.estado; 
            
            // Transição de Áudio da Aura
            if (!jogandoAura && dados.voce_esta_jogando) tocarMusica("aura");
            if (jogandoAura && !dados.voce_esta_jogando) tocarMusica(minhaSala);
            
            jogandoAura = dados.voce_esta_jogando;
            
            if (jogandoAura) {
                souP1Aura = dados.sou_p1;
                let meuPoder = souP1Aura ? dadosAura.p1_poder : dadosAura.p2_poder;
                
                // SISTEMA DE TREMOR CAÓTICO: O limite de 10 quebra após 300 de aura!
                if (meuPoder > 300) {
                    tremorTela = meuPoder / 12; // Terremoto absurdo
                } else {
                    tremorTela = Math.min(10, meuPoder / 50); 
                }
            } else {
                tremorTela = 0;
            }

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
        
        if (e.code === 'KeyE') {
            e.preventDefault();
            if (minhaSala === "sala_jogos" && !jogandoPong) {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'interagir_pong' }));
            } 
            else if (minhaSala === "museu") {
                if (obraVisivel) obraVisivel = null;
                else {
                    let cx = meuBicho.x + meuBicho.tamanho / 2; let cy = meuBicho.y + meuBicho.tamanho / 2;
                    for (let q of quadrosMuseu) { if (Math.abs(cx - (q.x + q.w/2)) < 45 && cy > q.y && cy < q.y + 110) { obraVisivel = q; break; } }
                }
            }
            else if (minhaSala === "o_quarto" && !jogandoAura) {
                let cx = meuBicho.x + meuBicho.tamanho / 2; let cy = meuBicho.y + meuBicho.tamanho / 2;
                if (Math.abs(cx - (tvQuarto.x + tvQuarto.w/2)) < 50 && Math.abs(cy - (tvQuarto.y + tvQuarto.h/2)) < 50) {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'interagir_aura' }));
                }
            }
        }
        
        if (jogandoAura && (e.code === 'Space' || e.code === 'Enter')) {
            e.preventDefault();
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'spam_aura' }));
        }

        if (e.code === 'KeyQ') {
            if (obraVisivel) obraVisivel = null;
            if (jogandoAura && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'sair_aura' }));
        }
    }
});
window.addEventListener('keyup', (e) => { teclas[e.code] = false; });
window.addEventListener('blur', () => { teclas = {}; if(meuBicho) meuBicho.animTick = 0; });

function atualizarFisica() {
    if (estadoTransicao !== "idle") { targetFade(); return; }
    let dx = 0; let dy = 0;
    
    if (jogandoAura) return; 

    if (jogandoPong) {
        if (teclas['ArrowUp'] || teclas['KeyW']) { ws.send(JSON.stringify({ tipo: 'comando_pong', acao: 'subir' })); }
        if (teclas['ArrowDown'] || teclas['KeyS']) { ws.send(JSON.stringify({ tipo: 'comando_pong', acao: 'descer' })); }
        if (teclas['KeyQ']) { ws.send(JSON.stringify({ tipo: 'sair_pong' })); }
    } else if (obraVisivel) {
        dx = 0; dy = 0; 
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
    } else { 
        if (!jogandoPong) meuBicho.animTick = 0; 
    }

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
            outrosJogadores = {}; legendaTimer = 180; estadoTransicao = "fade_in"; teclas = {}; 
            jogandoPong = false; obraVisivel = null; jogandoAura = false;
            
            // Toca a música da nova sala após passar pela porta
            tocarMusica(portaPendente.destino);
            
            if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: "mudar_sala", nova_sala: portaPendente.destino, x: portaPendente.spawnX, y: portaPendente.spawnY, lado: meuBicho.lado }));
        }
    } else if (estadoTransicao === "fade_in") { transicaoAlpha -= 0.05; if (transicaoAlpha <= 0) { transicaoAlpha = 0; estadoTransicao = "idle"; portaPendente = null; } }
}

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

// ==========================================
// EFEITOS DE AURA CAÓTICA (NÍVEIS DE POLUIÇÃO)
// ==========================================
function renderizarFogoAura(cx, cy, poder, cor) {
    ctx.save();
    
    // Calcula o nível de caos baseado nas centenas
    let nivelCaos = Math.floor(poder / 100);
    
    let raioX = 20 + (poder / 10); 
    let raioY = 30 + (poder / 5); 
    
    // Nível 2+: Multiplica loucamente o número de partículas
    let limiteQtd = (nivelCaos >= 2) ? 400 : 100; 
    let qtd = Math.min(limiteQtd, Math.floor(poder / 2) + 10);
    
    // Nível 3+: Efeito de brilho estourado (Overbloom)
    if (nivelCaos >= 3) {
        ctx.globalCompositeOperation = "lighter";
    }

    // Desenha as partículas
    for(let i=0; i<qtd; i++) {
        let px = cx + (Math.random() - 0.5) * raioX * 2;
        let py = cy + (Math.random() - 0.2) * raioY - (poder/8);
        
        // Nível 3+: Partículas ficam gigantes
        let expansaoTam = (nivelCaos >= 3) ? (poder / 15) : (poder / 50);
        let tam = Math.random() * (4 + expansaoTam);
        
        ctx.fillStyle = cor;
        
        // Nível 1+: Partículas piscam branco (Energia pura)
        if (nivelCaos >= 1 && Math.random() > 0.8) ctx.fillStyle = "#ffffff";
        // Nível 2+: Partículas pretas caóticas (Corrupção visual)
        if (nivelCaos >= 2 && Math.random() > 0.9) ctx.fillStyle = "#000000";
        
        ctx.globalAlpha = Math.random(); 
        ctx.fillRect(px, py, tam, tam);
    }

    // Nível 2+: Desenha raios malucos ziguezagueando
    if (nivelCaos >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = (Math.random() > 0.5) ? cor : "#ffffff";
        ctx.lineWidth = 2 + Math.random() * 4;
        ctx.moveTo(cx, cy);
        for(let j=0; j<5; j++) {
            // Raios ficam maiores de acordo com o poder
            ctx.lineTo(cx + (Math.random() - 0.5) * (100 + poder/2), cy + (Math.random() - 0.5) * (100 + poder/2));
        }
        ctx.stroke();
    }
    
    ctx.restore();
}

function desenharInteracoesEspeciais() {
    let cx = meuBicho.x + meuBicho.tamanho / 2; let cy = meuBicho.y + meuBicho.tamanho / 2;

    if (minhaSala === "sala_jogos" && !jogandoPong) {
        if (cx > mesaPong.x - 20 && cx < mesaPong.x + mesaPong.w + 20 && cy > mesaPong.y - 20 && cy < mesaPong.y + mesaPong.h + 20) {
            ctx.fillStyle = "#161616"; ctx.fillRect(mesaPong.x + (mesaPong.w/2) - 35, mesaPong.y - 22, 70, 14); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(mesaPong.x + (mesaPong.w/2) - 35, mesaPong.y - 22, 70, 14);
            ctx.fillStyle = "#00ffcc"; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.fillText("[E] JOGAR PONG", mesaPong.x + (mesaPong.w/2), mesaPong.y - 12);
        }
    }
    if (minhaSala === "museu" && !obraVisivel) {
        for (let q of quadrosMuseu) {
            if (Math.abs(cx - (q.x + q.w/2)) < 45 && cy > q.y && cy < q.y + 110) {
                ctx.fillStyle = "#161616"; ctx.fillRect(q.x + (q.w/2) - 35, q.y - 15, 70, 14); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(q.x + (q.w/2) - 35, q.y - 15, 70, 14);
                ctx.fillStyle = "#00ffcc"; ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.fillText("[E] OBSERVAR", q.x + (q.w/2), q.y - 5); break; 
            }
        }
    }
    if (minhaSala === "o_quarto" && !jogandoAura) {
        if (Math.abs(cx - (tvQuarto.x + tvQuarto.w/2)) < 50 && Math.abs(cy - (tvQuarto.y + tvQuarto.h/2)) < 50) {
            ctx.fillStyle = "#161616"; ctx.fillRect(tvQuarto.x - 15, tvQuarto.y - 20, 70, 14); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(tvQuarto.x - 15, tvQuarto.y - 20, 70, 14);
            ctx.fillStyle = "#ff00ff"; ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.fillText("[E] LIGAR TV", tvQuarto.x + 20, tvQuarto.y - 10);
        }
    }
}

function desenharReguaDebug() {
    ctx.save(); ctx.strokeStyle = "rgba(0, 255, 100, 0.35)"; ctx.lineWidth = 0.5; ctx.font = "7px monospace"; ctx.fillStyle = "rgba(0, 150, 60, 0.85)"; ctx.textAlign = "left";
    for (let x = 0; x <= canvas.width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); ctx.fillText(x, x + 2, 10); }
    for (let y = 0; y <= canvas.height; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); ctx.fillText(y, 2, y + 8); }
    MAPAS[minhaSala].portas.forEach(p => { ctx.strokeStyle = "#ff2255"; ctx.lineWidth = 1; ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.fillStyle = "#ff2255"; ctx.fillText(`🚪->${p.destino.toUpperCase()}`, p.x, p.y - 3); });
    if (minhaSala === "o_quarto") { ctx.strokeStyle = "rgba(255, 0, 255, 0.5)"; ctx.strokeRect(tvQuarto.x, tvQuarto.y, tvQuarto.w, tvQuarto.h); }
    ctx.restore();
}

function desenhar() {
    ctx.save();
    
    // Aplica o Terremoto da Aura na tela inteira
    if (jogandoAura && tremorTela > 0) {
        let tx = (Math.random() - 0.5) * tremorTela; let ty = (Math.random() - 0.5) * tremorTela; ctx.translate(tx, ty);
    }

    const salaAtual = MAPAS[minhaSala]; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false; ctx.mozImageSmoothingEnabled = false; ctx.webkitImageSmoothingEnabled = false;
    
    const imgFundo = imagensCenarios[minhaSala];
    if (imgFundo && imgFundo.complete && imgFundo.naturalWidth !== 0) ctx.drawImage(imgFundo, 0, 0, canvas.width, canvas.height);
    else { ctx.fillStyle = salaAtual.corFundo; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    ctx.font = "10px monospace"; ctx.textAlign = "center";
    desenharInteracoesEspeciais();

    for (let id in outrosJogadores) {
        let p = outrosJogadores[id]; let imgSpriteOutro = imagensSprites[p.spriteId];
        let bobeioYOutro = (p.animTick > 0) ? Math.abs(Math.sin(p.animTick)) * -5 : 0;
        if (imgSpriteOutro && imgSpriteOutro.complete && imgSpriteOutro.naturalWidth !== 0) desenharSpriteInvertido(imgSpriteOutro, p.x, p.y + bobeioYOutro, meuBicho.tamanho, p.lado);
        else { ctx.fillStyle = "#888888"; ctx.fillRect(p.x, p.y + bobeioYOutro, meuBicho.tamanho, meuBicho.tamanho); }
        desenharCrachaNome(p.username, p.x + (meuBicho.tamanho/2), p.y - 5 + bobeioYOutro);
        if (p.chatTimer > 0) desenharBalao(p.chatTexto, p.x + (meuBicho.tamanho/2), p.y + bobeioYOutro);
        else if (p.isTyping) desenharBalao("...", p.x + (meuBicho.tamanho/2), p.y + bobeioYOutro, true);
    }

    let bobeioYMeu = (!jogandoPong && !obraVisivel && !jogandoAura && meuBicho.animTick > 0) ? Math.abs(Math.sin(meuBicho.animTick)) * -5 : 0;
    let imgMeuSprite = imagensSprites[meuBicho.spriteId];
    if (imgMeuSprite && imgMeuSprite.complete && imgMeuSprite.naturalWidth !== 0) { desenharSpriteInvertido(imgMeuSprite, meuBicho.x, meuBicho.y + bobeioYMeu, meuBicho.tamanho, meuBicho.lado); } 
    else { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(meuBicho.x, meuBicho.y + bobeioYMeu, meuBicho.tamanho, meuBicho.tamanho); }
    
    desenharCrachaNome(meuBicho.username, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y - 5 + bobeioYMeu);
    if (meuBicho.chatTimer > 0) desenharBalao(meuBicho.chatTexto, meuBicho.x + (meuBicho.tamanho/2), meuBicho.y + bobeioYMeu);
    else if (document.activeElement === chatInput) desenharBalao("...", meuBicho.x + (meuBicho.tamanho/2), meuBicho.y + bobeioYMeu, true);

    if (jogandoPong) {
        let px = 100; let py = 40; let pw = 200; let ph = 140;
        ctx.fillStyle = "#000000"; ctx.fillRect(px, py, pw, ph); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw / 2, py + ph); ctx.stroke(); ctx.setLineDash([]);
        let escX = pw / 200; let escY = ph / 150;
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(px + 6 * escX, py + dadosPong.p1_y * escY, 4 * escX, 25 * escY); ctx.fillRect(px + (200 - 10) * escX, py + dadosPong.p2_y * escY, 4 * escX, 25 * escY); ctx.fillRect(px + dadosPong.bola_x * escX, py + dadosPong.bola_y * escY, 5 * escX, 5 * escY);   
        ctx.font = "16px monospace"; ctx.textAlign = "center"; ctx.fillText(dadosPong.p1_score, px + (pw * 0.25), py + 25); ctx.fillText(dadosPong.p2_score, px + (pw * 0.75), py + 25);
        ctx.font = "9px monospace"; ctx.fillStyle = "#ff2255"; ctx.fillText("[Q] LARGAR CONTROLE", 200, py + ph + 15);
    }

    if (obraVisivel) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        let mw = 280; let mh = 180; let mx = (canvas.width - mw) / 2; let my = (canvas.height - mh) / 2 - 15;
        ctx.fillStyle = "#111111"; ctx.fillRect(mx, my, mw, mh); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mw, mh);
        let imgArte = imagensObras[obraVisivel.id];
        if (imgArte && imgArte.complete && imgArte.naturalWidth !== 0) ctx.drawImage(imgArte, mx + 10, my + 10, mw - 20, mh - 20);
        ctx.fillStyle = "#161616"; ctx.fillRect(mx + 40, my + mh - 5, mw - 80, 20); ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(mx + 40, my + mh - 5, mw - 80, 20);
        ctx.fillStyle = "#FFFFFF"; ctx.font = "10px monospace"; ctx.textAlign = "center"; ctx.fillText(obraVisivel.titulo, canvas.width/2, my + mh + 8);
        ctx.fillStyle = "#ff2255"; ctx.font = "8px monospace"; ctx.fillText("[E] ou [Q] PARA FECHAR A GALERIA", canvas.width/2, my + mh + 28);
    }

    if (jogandoAura) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let cxP1 = 100; let cyP1 = 150; let cxP2 = 300; let cyP2 = 150; let tamDuelo = 64; 
        let corP1 = souP1Aura ? "#00ffff" : "#ff0055"; 
        let corP2 = souP1Aura ? "#ff0055" : "#00ffff"; 

        // Passa o nível de aura atual pra desenhar o caos
        renderizarFogoAura(cxP1 + tamDuelo/2, cyP1 + tamDuelo/2, dadosAura.p1_poder, corP1);
        renderizarFogoAura(cxP2 + tamDuelo/2, cyP2 + tamDuelo/2, dadosAura.p2_poder, corP2);

        let imgP1 = imagensSprites[dadosAura.p1_sprite] || imagensSprites["cinzaguy"];
        let imgP2 = imagensSprites[dadosAura.p2_sprite] || imagensSprites["cinzaguy"];
        
        if (imgP1 && imgP1.complete) desenharSpriteInvertido(imgP1, cxP1, cyP1, tamDuelo, "direita");
        if (imgP2 && imgP2.complete) desenharSpriteInvertido(imgP2, cxP2, cyP2, tamDuelo, "esquerda");

        ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 16px monospace"; ctx.textAlign = "center"; ctx.fillText("X1 DE AURA", canvas.width/2, 40);
        
        ctx.font = "10px monospace";
        ctx.fillStyle = corP1; ctx.fillText("AURA: " + Math.floor(dadosAura.p1_poder), cxP1 + tamDuelo/2, cyP1 - 10);
        ctx.fillStyle = corP2; ctx.fillText("AURA: " + Math.floor(dadosAura.p2_poder), cxP2 + tamDuelo/2, cyP2 - 10);

        ctx.fillStyle = (Math.floor(Date.now() / 100) % 2 === 0) ? "#ffff00" : "#ff8800"; 
        ctx.font = "12px monospace"; ctx.fillText("ESMAGUE A BARRA DE ESPAÇO!", canvas.width/2, 250);
        ctx.fillStyle = "#aaaaaa"; ctx.font = "9px monospace"; ctx.fillText("[Q] PARA DESLIGAR A TV", canvas.width/2, 280);
    }

    if (mostrarDebug) { desenharReguaDebug(); }
    if (transicaoAlpha > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${transicaoAlpha})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.restore(); 
}

function loop(timestamp) { requestAnimationFrame(loop); const tempoDecorrido = timestamp - tempoAnterior; if (tempoDecorrido >= intervaloFps) { tempoAnterior = timestamp - (tempoDecorrido % intervaloFps); atualizarFisica(); desenhar(); } }