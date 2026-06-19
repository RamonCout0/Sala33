SALA33_REGISTRAR("raid", {

    // ── Estado ────────────────────────────────────────
    _fase:          "idle",
    _progresso:     0,
    _esquivou:      false,
    _flashTimer:    0,
    _feedbackTimer: 0,
    _feedbackTipo:  null, // "parry" | "hit"
    _neve:          [],
    _fogo:          [],
    _fumaca:        [],
    _explosao:      [],
    _boss:          { x: 200, y: 50 },
    _zonaSegura:    { x: 5, y: 100, w: 65, h: 110 },
    _sprites:       {},

    // ── Hooks ─────────────────────────────────────────
    onEnter(salaConfig) {
        this._boss       = salaConfig.extras?.boss       || { x: 200, y: 50 };
        this._zonaSegura = salaConfig.extras?.zonaSegura || { x: 5, y: 100, w: 65, h: 110 };
        this._fase       = "idle";
        this._esquivou   = false;
        this._fogo       = [];
        this._fumaca     = [];
        this._explosao   = [];
        this._flashTimer    = 0;
        this._feedbackTimer = 0;
        this._feedbackTipo  = null;

        this._neve = Array.from({ length: 80 }, () => ({
            x:     Math.random() * 400,
            y:     Math.random() * 300,
            vel:   0.3 + Math.random() * 0.7,
            drift: (Math.random() - 0.5) * 0.2,
            tam:   1 + Math.random() * 2,
        }));

        this._sprites = {};
        const defs = salaConfig.extras?.sprites || {};
        for (const [fase, path] of Object.entries(defs)) {
            const img = new Image();
            img.onerror = () => { img._erro = true; };  // só marca se REALMENTE falhar
            img.src = path;
            this._sprites[fase] = img;
        }
    },

    onSair() {
        this._fase          = "idle";
        this._esquivou      = false;
        this._fogo          = [];
        this._fumaca        = [];
        this._explosao      = [];
        this._feedbackTimer = 0;
    },

    onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual) {
        if (dados.tipo === "raid_boss") {
            this._fase      = dados.fase;
            this._progresso = dados.progresso || 0;

            if (dados.fase === "ataque") {
                this._flashTimer = 20;
                this._criarExplosao(this._boss.x, this._boss.y + 160);
                // Esquivou → PARRY. O "ATINGIDO" agora vem do evento raid_empurrao
                // (só quem foi REALMENTE jogado), pra bater com o que acontece de fato.
                if (this._esquivou) {
                    this._feedbackTipo  = "parry";
                    this._feedbackTimer = 70;
                }
                this._esquivou = false;
            }
            if (dados.fase === "idle") {
                this._esquivou = false;
            }
            return true;
        }
        if (dados.tipo === "raid_esquiva") {
            this._esquivou = true;
            return true;
        }
        if (dados.tipo === "raid_empurrao") {
            // O servidor me jogou pro spawn — move o meu boneco de verdade
            // e dispara o feedback de "ATINGIDO" (quem foi empurrado de fato).
            meuBicho.x = dados.x;
            meuBicho.y = dados.y;
            this._feedbackTipo  = "hit";
            this._feedbackTimer = 70;
            return true;
        }
        return false;
    },

    onTeclaDown(code, ws, meuBicho) {
        if (code === "KeyE" && this._fase === "carregando" && !this._esquivou) {
            ws.send(JSON.stringify({ tipo: "esquivar_raid" }));
            return true;
        }
        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        const tremor = this._fase === "carregando" ? this._progresso * 5
                     : this._fase === "ataque"     ? 10
                     : 0;
        return { bloqueiaMovimento: false, tremor };
    },

    // ── Render ────────────────────────────────────────
    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        this._desenharZonaSegura(ctx);
        this._atualizarNeve(ctx);

        // Fumaça (atrás do boss)
        ctx.save(); this._atualizarFumaca(ctx); ctx.restore();

        // Boss + fogo
        this._desenharBoss(ctx);

        // Explosão (na frente de tudo)
        ctx.save(); this._atualizarExplosao(ctx); ctx.restore();

        // Flash de ataque
        if (this._flashTimer > 0) {
            this._flashTimer--;
            ctx.fillStyle = `rgba(255,255,255,${(this._flashTimer / 20) * 0.45})`;
            ctx.fillRect(0, 0, 400, 300);
        }

        // Feedback parry / hit
        this._desenharFeedback(ctx, meuBicho);

        this._desenharHUD(ctx);
    },

    // ── Partículas ────────────────────────────────────
    _criarFogo(cx, cy, quantidade, intensidade) {
        for (let i = 0; i < quantidade; i++) {
            this._fogo.push({
                x:     cx + (Math.random() - 0.5) * 20,
                y:     cy + (Math.random() - 0.5) * 10,
                vx:    (Math.random() - 0.5) * intensidade * 0.8,
                vy:    (1 + Math.random() * intensidade * 1.5), // desce
                vida:  1.0,
                decay: 0.02 + Math.random() * 0.03,
                tam:   2 + Math.random() * (intensidade * 2),
            });
        }
        if (this._fogo.length > 600) this._fogo.splice(0, this._fogo.length - 600);
    },

    _atualizarFogo(ctx) {
        this._fogo = this._fogo.filter(p => p.vida > 0);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";  // brilho aditivo → glow do sopro
        for (const p of this._fogo) {
            p.x    += p.vx;
            p.y    += p.vy;
            p.vy   += 0.05;  // acelera pra baixo
            p.vx   *= 0.98;
            p.vida -= p.decay;
            p.tam  *= 0.992;
            const lum = Math.floor(120 + p.vida * 135);  // núcleo quente (claro)
            ctx.globalAlpha = p.vida * 0.5;
            ctx.fillStyle   = `rgb(${lum},${lum},${lum})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.5, p.tam), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },

    _criarFumaca(cx, cy, quantidade) {
        for (let i = 0; i < quantidade; i++) {
            this._fumaca.push({
                x:     cx + (Math.random() - 0.5) * 50,
                y:     cy + (Math.random() - 0.5) * 20,
                vx:    (Math.random() - 0.5) * 0.6,
                vy:    -(0.4 + Math.random() * 0.6), // sobe
                vida:  1.0,
                decay: 0.006 + Math.random() * 0.008,
                tam:   10 + Math.random() * 18,
            });
        }
        if (this._fumaca.length > 200) this._fumaca.splice(0, this._fumaca.length - 200);
    },

    _atualizarFumaca(ctx) {
        this._fumaca = this._fumaca.filter(p => p.vida > 0);
        for (const p of this._fumaca) {
            p.x    += p.vx;
            p.y    += p.vy;
            p.vida -= p.decay;
            p.tam  *= 1.006;
            const lum = Math.floor(40 + p.vida * 70);
            const a   = p.vida * 0.3;
            // Gradiente radial → fumaça com borda suave (não mais quadrados)
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.tam);
            g.addColorStop(0, `rgba(${lum},${lum},${lum},${a})`);
            g.addColorStop(1, `rgba(${lum},${lum},${lum},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.tam, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    },

    _criarExplosao(cx, cy) {
        for (let i = 0; i < 50; i++) {
            const angulo = (Math.PI * 2 / 50) * i + (Math.random() - 0.5) * 0.4;
            const vel    = 2 + Math.random() * 6;
            this._explosao.push({
                x:     cx + (Math.random() - 0.5) * 15,
                y:     cy + (Math.random() - 0.5) * 15,
                vx:    Math.cos(angulo) * vel,
                vy:    Math.sin(angulo) * vel,
                vida:  1.0,
                decay: 0.03 + Math.random() * 0.04,
                tam:   3 + Math.random() * 7,
            });
        }
        this._criarFumaca(cx, cy, 20);
        if (this._explosao.length > 300) this._explosao.splice(0, this._explosao.length - 300);
    },

    _atualizarExplosao(ctx) {
        this._explosao = this._explosao.filter(p => p.vida > 0);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";  // estouro luminoso
        for (const p of this._explosao) {
            p.x    += p.vx;
            p.y    += p.vy;
            p.vy   += 0.12;
            p.vx   *= 0.97;
            p.vida -= p.decay;
            p.tam  *= 0.96;
            const lum = Math.floor(140 + p.vida * 115);
            ctx.globalAlpha = p.vida * 0.8;
            ctx.fillStyle   = `rgb(${lum},${lum},${lum})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.5, p.tam), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },

    // ── Helpers de render ─────────────────────────────
    _desenharZonaSegura(ctx) {
        const z = this._zonaSegura;
        ctx.save();
        ctx.strokeStyle = "rgba(0,255,100,0.35)";
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = "rgba(0,255,100,0.04)";
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = "rgba(0,255,100,0.4)";
        ctx.font      = "7px monospace";
        ctx.textAlign = "center";
        ctx.setLineDash([]);
        ctx.fillText("ÁREA",   z.x + z.w / 2, z.y + z.h / 2 - 5);
        ctx.fillText("SEGURA", z.x + z.w / 2, z.y + z.h / 2 + 6);
        ctx.restore();
    },

    _atualizarNeve(ctx) {
        ctx.save();
        const vel = this._fase === "ataque" ? 2 : 1;
        for (const p of this._neve) {
            p.y += p.vel * vel;
            p.x += p.drift;
            if (p.y > 300) { p.y = -5; p.x = Math.random() * 400; }
            if (p.x > 400) p.x = 0;
            if (p.x < 0)   p.x = 400;
            ctx.globalAlpha = this._fase === "ataque" ? 0.9 : 0.35;
            ctx.fillStyle   = "#ffffff";
            ctx.fillRect(p.x, p.y, p.tam, p.tam);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    },

    _desenharBoss(ctx) {
        const bx   = this._boss.x;
        const by   = this._boss.y;
        const fase = this._fase;
        const prog = this._progresso;

        if (fase === "carregando") {
            const qtd = Math.floor(prog * 4) + 1;
            this._criarFogo(bx, by + 50, qtd, 1.5 + prog * 2);
        }
        if (fase === "ataque") {
            // Sopro para baixo em coluna
            this._criarFogo(bx - 10, by + 55, 15, 4);
            this._criarFogo(bx + 10, by + 55, 10, 3.5);
            this._criarFogo(bx,      by + 90, 8,  3);
        }

        ctx.save(); this._atualizarFogo(ctx); ctx.restore();

        const img = this._sprites[fase] || this._sprites["idle"];
        const pronto = img?.complete && img.naturalWidth !== 0;
        if (pronto) {
            const w = 180, h = 150; // tamanho aumentado
            ctx.drawImage(img, bx - w / 2, by, w, h);
            if (fase === "ataque") {
                // Brilho no FORMATO do dragão: redesenha o sprite em 'screen'
                // (antes era um retângulo branco → virava um quadrado ao redor dele).
                ctx.save();
                ctx.globalCompositeOperation = "screen";
                ctx.globalAlpha = 0.4;
                ctx.drawImage(img, bx - w / 2, by, w, h);
                ctx.restore();
            }
        } else if (img?._erro) {
            // Só usa o dragão procedural se o PNG REALMENTE falhou — não enquanto carrega
            // (senão ele pisca como um "placeholder" nos primeiros frames).
            this._desenharDragaoProcedural(ctx, bx, by, fase, prog);
        }
    },

    _desenharDragaoProcedural(ctx, bx, by, fase, progresso) {
        const S   = 1.6; // fator de escala
        const cor = fase === "ataque" ? "#ffffff" : "#666";
        ctx.fillStyle = cor;

        // Corpo
        ctx.fillRect(bx - 50*S, by + 14*S, 100*S, 65*S);

        // Asas
        ctx.beginPath();
        ctx.moveTo(bx - 50*S, by + 20*S);
        ctx.lineTo(bx - 120*S, by - 14*S);
        ctx.lineTo(bx - 50*S,  by + 55*S);
        ctx.closePath(); ctx.fill();

        ctx.beginPath();
        ctx.moveTo(bx + 50*S, by + 20*S);
        ctx.lineTo(bx + 120*S, by - 14*S);
        ctx.lineTo(bx + 50*S,  by + 55*S);
        ctx.closePath(); ctx.fill();

        // Cabeça
        ctx.fillRect(bx - 30*S, by - 28*S, 60*S, 44*S);

        // Mandíbula
        const abertura = fase === "ataque" ? 28*S
            : fase === "carregando" ? progresso * 24*S
            : 3;
        ctx.fillStyle = "#000";
        ctx.fillRect(bx - 22*S, by + 12*S, 44*S, abertura);

        // Olhos pulsantes
        const pulso = Math.abs(Math.sin(Date.now() / 100));
        const lum   = fase === "carregando" ? Math.floor(100 + pulso * 155 * progresso)
                    : fase === "ataque"     ? 255 : 180;
        ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
        ctx.fillRect(bx - 22*S, by - 20*S, 11*S, 11*S);
        ctx.fillRect(bx + 11*S, by - 20*S, 11*S, 11*S);
    },

    _desenharFeedback(ctx, meuBicho) {
        if (this._feedbackTimer <= 0) return;
        this._feedbackTimer--;

        const t     = 1 - this._feedbackTimer / 70;   // progresso 0 → 1
        const alpha = Math.min(1, (1 - t) * 1.8);      // segura visível e some no fim
        const cx    = meuBicho.x + 16;
        const cy    = meuBicho.y - 12 - t * 28;        // sobe enquanto some

        ctx.save();
        ctx.textAlign = "center";

        if (this._feedbackTipo === "parry") {
            // Anel de impacto que estoura no início
            const ringR = t * 48;
            ctx.globalAlpha = Math.max(0, 1 - t * 1.4) * 0.8;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(meuBicho.x + 16, meuBicho.y + 2, ringR, 0, Math.PI * 2);
            ctx.stroke();

            // Texto com "pop" — escala estoura grande e assenta
            const pop = 1 + Math.max(0, 0.45 - t) * 2.4;
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = "#ffffff";
            ctx.font        = `bold ${Math.floor(20 * pop)}px monospace`;
            ctx.fillText("PARRY!", cx, cy);
            ctx.globalAlpha = alpha * 0.7;
            ctx.font        = "bold 9px monospace";
            ctx.fillText("esquiva perfeita", cx, cy + 12);
        } else {
            // Hit — tremor horizontal pra dar impacto
            const shake = Math.max(0, 1 - t) * 5;
            const dx    = Math.sin(this._feedbackTimer * 0.8) * shake;
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = "#cccccc";
            ctx.font        = `bold ${Math.floor(18 + Math.max(0, 0.4 - t) * 18)}px monospace`;
            ctx.fillText("ATINGIDO!", cx + dx, cy);
            ctx.globalAlpha = alpha * 0.7;
            ctx.fillStyle   = "#999999";
            ctx.font        = "9px monospace";
            ctx.fillText("empurrado!", cx, cy + 12);
        }
        ctx.restore();
    },

    _desenharHUD(ctx) {
        ctx.font      = "9px monospace";
        ctx.textAlign = "center";

        if (this._fase === "idle") {
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.fillText("O dragão está descansando...", 200, 285);
            return;
        }

        if (this._fase === "carregando") {
            const piscada = Math.floor(Date.now() / 300) % 2 === 0;
            if (!this._esquivou) {
                ctx.fillStyle = piscada ? "#ffffff" : "#888888";
                ctx.font      = "bold 11px monospace";
                ctx.fillText("⚠ PRESSIONE [E] PARA ESQUIVAR!", 200, 260);
            } else {
                ctx.fillStyle = "#cccccc";
                ctx.font      = "bold 10px monospace";
                ctx.fillText("✓ ESQUIVA REGISTRADA — AGUARDE", 200, 260);
            }

            // Barra grayscale
            const bw = 200, bh = 12;
            const bx = (400 - bw) / 2, by2 = 270;
            ctx.fillStyle = "#0a0a0a";
            ctx.fillRect(bx, by2, bw, bh);
            const brilho = Math.floor(60 + this._progresso * 195);
            ctx.fillStyle = `rgb(${brilho},${brilho},${brilho})`;
            ctx.fillRect(bx, by2, bw * this._progresso, bh);
            ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
            ctx.strokeRect(bx, by2, bw, bh);
            return;
        }

        if (this._fase === "ataque") {
            ctx.font      = "bold 18px monospace";
            ctx.fillStyle = "#ffffff";
            ctx.fillText("SOPRO DO DRAGÃO!", 200, 260);
            return;
        }

        if (this._fase === "reset") {
            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.fillText("...", 200, 285);
        }
    },
});
