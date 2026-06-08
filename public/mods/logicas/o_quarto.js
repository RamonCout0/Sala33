// =====================================================
//   MECÂNICA: DUELO DE AURA
//   Sala: o_quarto
//   Servidor: server_mods/o_quarto.py
// =====================================================

SALA33_REGISTRAR("o_quarto", {
    _jogando: false,
    _souP1: false,
    _dados: { p1_poder: 0, p2_poder: 0, p1_sprite: "cinzaguy", p2_sprite: "cinzaguy" },
    _tremor: 0,
    _tv: { x: 195, y: 250, w: 40, h: 30 },

    onEnter(salaConfig) {
        if (salaConfig?.extras?.tvAura) this._tv = salaConfig.extras.tvAura;
        this._jogando = false;
        this._tremor = 0;
    },

    onSair() {
        this._jogando = false;
        this._tremor = 0;
    },

    onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual) {
        if (dados.tipo !== "atualizacao_aura") return false;

        if (!this._jogando && dados.voce_esta_jogando) tocarMusica("aura");
        if (this._jogando && !dados.voce_esta_jogando) { tocarMusica(salaAtual); this._tremor = 0; }

        this._jogando = dados.voce_esta_jogando;
        this._dados = dados.estado;

        if (this._jogando) {
            this._souP1 = dados.sou_p1;
            const meuPoder = this._souP1 ? this._dados.p1_poder : this._dados.p2_poder;
            // Sistema de tremor caótico: quebra o teto após 300 de aura
            this._tremor = meuPoder > 300 ? meuPoder / 12 : Math.min(10, meuPoder / 50);
        } else {
            this._tremor = 0;
        }

        if (dados.meu_x !== undefined) meuBicho.x = dados.meu_x;
        if (dados.meu_y !== undefined) meuBicho.y = dados.meu_y;
        if (dados.meu_lado !== undefined) meuBicho.lado = dados.meu_lado;
        return true;
    },

    onTeclaDown(code, ws, meuBicho) {
        if (code === "KeyE" && !this._jogando) {
            const tv = this._tv;
            const cx = meuBicho.x + meuBicho.tamanho / 2;
            const cy = meuBicho.y + meuBicho.tamanho / 2;
            if (Math.abs(cx - (tv.x + tv.w/2)) < 50 && Math.abs(cy - (tv.y + tv.h/2)) < 50) {
                ws.send(JSON.stringify({ tipo: "interagir_aura" }));
                return true;
            }
        }
        if (this._jogando && (code === "Space" || code === "Enter")) {
            ws.send(JSON.stringify({ tipo: "spam_aura" }));
            return true;
        }
        if (code === "KeyQ" && this._jogando) {
            ws.send(JSON.stringify({ tipo: "sair_aura" }));
            return true;
        }
        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        return { bloqueiaMovimento: this._jogando, tremor: this._tremor };
    },

    _renderFogo(ctx, cx, cy, poder, cor) {
        ctx.save();
        const nivelCaos = Math.floor(poder / 100);
        const raioX = 20 + poder / 10;
        const raioY = 30 + poder / 5;
        const limiteQtd = nivelCaos >= 2 ? 400 : 100;
        const qtd = Math.min(limiteQtd, Math.floor(poder / 2) + 10);

        if (nivelCaos >= 3) ctx.globalCompositeOperation = "lighter";

        for (let i = 0; i < qtd; i++) {
            const px = cx + (Math.random() - 0.5) * raioX * 2;
            const py = cy + (Math.random() - 0.2) * raioY - poder / 8;
            const expansao = nivelCaos >= 3 ? poder / 15 : poder / 50;
            const tam = Math.random() * (4 + expansao);

            ctx.fillStyle = cor;
            if (nivelCaos >= 1 && Math.random() > 0.8) ctx.fillStyle = "#ffffff";
            if (nivelCaos >= 2 && Math.random() > 0.9) ctx.fillStyle = "#000000";
            ctx.globalAlpha = Math.random();
            ctx.fillRect(px, py, tam, tam);
        }

        if (nivelCaos >= 2) {
            ctx.beginPath();
            ctx.strokeStyle = Math.random() > 0.5 ? cor : "#ffffff";
            ctx.lineWidth = 2 + Math.random() * 4;
            ctx.moveTo(cx, cy);
            for (let j = 0; j < 5; j++) {
                ctx.lineTo(cx + (Math.random() - 0.5) * (100 + poder/2), cy + (Math.random() - 0.5) * (100 + poder/2));
            }
            ctx.stroke();
        }
        ctx.restore();
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        // Hint "[E] LIGAR TV"
        if (!this._jogando) {
            const tv = this._tv;
            const cx = meuBicho.x + tamSprite / 2;
            const cy = meuBicho.y + tamSprite / 2;
            if (Math.abs(cx - (tv.x + tv.w/2)) < 50 && Math.abs(cy - (tv.y + tv.h/2)) < 50) {
                ctx.fillStyle = "#161616"; ctx.fillRect(tv.x - 15, tv.y - 20, 70, 14);
                ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(tv.x - 15, tv.y - 20, 70, 14);
                ctx.fillStyle = "#ff00ff"; ctx.font = "7px monospace"; ctx.textAlign = "center";
                ctx.fillText("[E] LIGAR TV", tv.x + 20, tv.y - 10);
            }
            return;
        }

        // Tela do duelo
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0, 0, 400, 300);

        const cxP1 = 100, cyP1 = 150, cxP2 = 300, cyP2 = 150, tam = 64;
        const corP1 = this._souP1 ? "#00ffff" : "#ff0055";
        const corP2 = this._souP1 ? "#ff0055" : "#00ffff";

        this._renderFogo(ctx, cxP1 + tam/2, cyP1 + tam/2, this._dados.p1_poder, corP1);
        this._renderFogo(ctx, cxP2 + tam/2, cyP2 + tam/2, this._dados.p2_poder, corP2);

        const imgP1 = imagensSprites[this._dados.p1_sprite] || imagensSprites["cinzaguy"];
        const imgP2 = imagensSprites[this._dados.p2_sprite] || imagensSprites["cinzaguy"];

        if (imgP1?.complete && imgP1.naturalWidth !== 0) {
            ctx.save(); ctx.translate(cxP1 + tam, cyP1); ctx.scale(-1, 1);
            ctx.drawImage(imgP1, 0, 0, tam, tam); ctx.restore();
        }
        if (imgP2?.complete && imgP2.naturalWidth !== 0) {
            ctx.drawImage(imgP2, cxP2, cyP2, tam, tam);
        }

        ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
        ctx.fillText("X1 DE AURA", 200, 40);
        ctx.font = "10px monospace";
        ctx.fillStyle = corP1; ctx.fillText("AURA: " + Math.floor(this._dados.p1_poder), cxP1 + tam/2, cyP1 - 10);
        ctx.fillStyle = corP2; ctx.fillText("AURA: " + Math.floor(this._dados.p2_poder), cxP2 + tam/2, cyP2 - 10);
        ctx.fillStyle = (Math.floor(Date.now() / 100) % 2 === 0) ? "#ffff00" : "#ff8800";
        ctx.font = "12px monospace"; ctx.fillText("ESMAGUE A BARRA DE ESPAÇO!", 200, 250);
        ctx.fillStyle = "#aaaaaa"; ctx.font = "9px monospace";
        ctx.fillText("[Q] PARA DESLIGAR A TV", 200, 280);
    },
});
