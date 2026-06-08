// =====================================================
//   MECÂNICA: PONG MULTIPLAYER
//   Sala: sala_jogos
//   Servidor: server_mods/sala_jogos.py
// =====================================================
//
// API de plugin (ver mods/README_MODS.md):
//   onEnter(salaConfig)   — chamado ao entrar na sala
//   onSair()              — chamado ao sair da sala
//   onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual)
//                         — retorne true se consumiu a mensagem
//   onTeclaDown(code, ws, meuBicho)
//                         — retorne true se consumiu a tecla
//   onFisica(meuBicho, ws, teclas)
//                         — retorne { bloqueiaMovimento, tremor }
//   render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite)

SALA33_REGISTRAR("sala_jogos", {
    _jogando: false,
    _dados: { p1_y: 60, p2_y: 60, bola_x: 100, bola_y: 75, p1_score: 0, p2_score: 0 },
    _mesa: { x: 180, y: 195, w: 130, h: 30 },

    onEnter(salaConfig) {
        if (salaConfig?.extras?.mesaPong) this._mesa = salaConfig.extras.mesaPong;
        this._jogando = false;
    },

    onSair() {
        this._jogando = false;
    },

    onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual) {
        if (dados.tipo !== "atualizacao_pong") return false;

        if (!this._jogando && dados.voce_esta_jogando) tocarMusica("pong");
        if (this._jogando && !dados.voce_esta_jogando) tocarMusica(salaAtual);

        this._jogando = dados.voce_esta_jogando;
        this._dados = dados.estado;

        if (dados.meu_x !== undefined) meuBicho.x = dados.meu_x;
        if (dados.meu_y !== undefined) meuBicho.y = dados.meu_y;
        if (dados.meu_lado !== undefined) meuBicho.lado = dados.meu_lado;
        return true;
    },

    onTeclaDown(code, ws, meuBicho) {
        if (code === "KeyE" && !this._jogando) {
            const m = this._mesa;
            const cx = meuBicho.x + meuBicho.tamanho / 2;
            const cy = meuBicho.y + meuBicho.tamanho / 2;
            if (cx > m.x - 20 && cx < m.x + m.w + 20 && cy > m.y - 20 && cy < m.y + m.h + 20) {
                ws.send(JSON.stringify({ tipo: "interagir_pong" }));
                return true;
            }
        }
        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        if (!this._jogando) return { bloqueiaMovimento: false, tremor: 0 };
        if (teclas["ArrowUp"] || teclas["KeyW"]) ws.send(JSON.stringify({ tipo: "comando_pong", acao: "subir" }));
        if (teclas["ArrowDown"] || teclas["KeyS"]) ws.send(JSON.stringify({ tipo: "comando_pong", acao: "descer" }));
        if (teclas["KeyQ"]) ws.send(JSON.stringify({ tipo: "sair_pong" }));
        return { bloqueiaMovimento: true, tremor: 0 };
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        // Hint "[E] JOGAR PONG" quando próximo da mesa
        if (!this._jogando) {
            const m = this._mesa;
            const cx = meuBicho.x + tamSprite / 2;
            const cy = meuBicho.y + tamSprite / 2;
            if (cx > m.x - 20 && cx < m.x + m.w + 20 && cy > m.y - 20 && cy < m.y + m.h + 20) {
                ctx.fillStyle = "#161616"; ctx.fillRect(m.x + m.w/2 - 35, m.y - 22, 70, 14);
                ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(m.x + m.w/2 - 35, m.y - 22, 70, 14);
                ctx.fillStyle = "#00ffcc"; ctx.font = "8px monospace"; ctx.textAlign = "center";
                ctx.fillText("[E] JOGAR PONG", m.x + m.w/2, m.y - 12);
            }
            return;
        }

        // Tela do Pong
        const d = this._dados;
        const px = 100, py = 40, pw = 200, ph = 140;
        ctx.fillStyle = "#000000"; ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
        ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px + pw/2, py); ctx.lineTo(px + pw/2, py + ph); ctx.stroke(); ctx.setLineDash([]);

        const escX = pw / 200, escY = ph / 150;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(px + 6 * escX, py + d.p1_y * escY, 4 * escX, 25 * escY);
        ctx.fillRect(px + (200 - 10) * escX, py + d.p2_y * escY, 4 * escX, 25 * escY);
        ctx.fillRect(px + d.bola_x * escX, py + d.bola_y * escY, 5 * escX, 5 * escY);
        ctx.font = "16px monospace"; ctx.textAlign = "center";
        ctx.fillText(d.p1_score, px + pw * 0.25, py + 25);
        ctx.fillText(d.p2_score, px + pw * 0.75, py + 25);
        ctx.font = "9px monospace"; ctx.fillStyle = "#ff2255";
        ctx.fillText("[Q] LARGAR CONTROLE", 200, py + ph + 15);
    },
});
