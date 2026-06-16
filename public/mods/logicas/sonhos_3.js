SALA33_REGISTRAR("sonhos_3", {
    _extras: null,
    _foraDaZona: false,
    _escuridao: 0,
    _frasesAtivas: [],
    _timerProximaFrase: 0,

    // Animação por frames PNG (substitui o GIF)
    _serFrames: [
        "assets/bosses/anjo_0.png",
        "assets/bosses/anjo_1.png",
        "assets/bosses/anjo_2.png",
        "assets/bosses/anjo_3.png",
        "assets/bosses/anjo_4.png",
        "assets/bosses/anjo_5.png"
    ],      // array de Image carregadas
    _frameAtual: 0,      // índice do frame atual
    _timerFrame: 0,      // contador de ticks até trocar frame

    _emDialogo: false,
    _dialogoIndex: 0,

    onEnter(salaConfig) {
        this._extras = salaConfig.extras || {};
        this._escuridao = 0;
        this._frasesAtivas = [];
        this._foraDaZona = false;
        this._timerProximaFrase = 0;
        this._emDialogo = false;
        this._dialogoIndex = 0;
        this._frameAtual = 0;
        this._timerFrame = 0;
        this._serFrames = [];

        // Carrega os frames do "ser" como Images normais (PNG, sem truque de DOM)
        const serCfg = this._extras.ser;
        if (serCfg?.frames?.length) {
            for (const src of serCfg.frames) {
                const img = new Image();
                img.src = src;
                this._serFrames.push(img);
            }
        }
    },

    onSair() {
        this._frasesAtivas = [];
        this._escuridao = 0;
        this._emDialogo = false;
        this._serFrames = [];
        this._frameAtual = 0;
        this._timerFrame = 0;
    },

    onMensagem() { return false; },

    onTeclaDown(code, ws, meuBicho) {
        const serCfg = this._extras.ser;
        if (!serCfg) return false;

        if (this._emDialogo) {
            if (code === "KeyE" || code === "Space" || code === "Enter") {
                this._dialogoIndex++;
                if (this._dialogoIndex >= serCfg.dialogo.length) {
                    this._emDialogo = false;
                    this._dialogoIndex = 0;
                }
                return true;
            }
            return true;
        }

        if (code === "KeyE") {
            const dx = meuBicho.x - serCfg.x;
            const dy = meuBicho.y - serCfg.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= (serCfg.raioInteracao ?? 50)) {
                this._emDialogo = true;
                this._dialogoIndex = 0;
                return true;
            }
        }

        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        if (this._emDialogo) {
            return { bloqueiaMovimento: true, tremor: 0 };
        }

        const zona = this._extras.zonaSegura;
        const dentro =
            meuBicho.x >= zona.x &&
            meuBicho.x <= zona.x + zona.w &&
            meuBicho.y >= zona.y &&
            meuBicho.y <= zona.y + zona.h;

        this._foraDaZona = !dentro;

        const velEsc = this._extras.velocidadeEscurecer ?? 0.15;
        const maxEsc = this._extras.escuridaoMax ?? 0.85;

        if (this._foraDaZona) {
            this._escuridao = Math.min(maxEsc, this._escuridao + velEsc / 60);
            this._timerProximaFrase -= 1 / 60;
            if (this._timerProximaFrase <= 0) {
                this._spawnFrase();
                this._timerProximaFrase = 0.8 + Math.random() * 1.2;
            }
        } else {
            this._escuridao = Math.max(0, this._escuridao - velEsc / 60);
            this._frasesAtivas = [];
            this._timerProximaFrase = 0;
        }

        this._frasesAtivas = this._frasesAtivas.filter(f => {
            f.vida -= 1 / 60;
            return f.vida > 0;
        });

        // Avança o frame do "ser" a cada N ticks
        // frameDelay no JSON controla a velocidade (padrão: 8 ticks ≈ 7.5fps)
        if (this._serFrames.length > 0) {
            const delay = this._extras.ser?.frameDelay ?? 8;
            this._timerFrame++;
            if (this._timerFrame >= delay) {
                this._timerFrame = 0;
                this._frameAtual = (this._frameAtual + 1) % this._serFrames.length;
            }
        }

        return { bloqueiaMovimento: false, tremor: this._foraDaZona ? this._escuridao * 1.5 : 0 };
    },

    _spawnFrase() {
        const frases = this._extras.frasesEco || [];
        if (frases.length === 0) return;

        const texto = frases[Math.floor(Math.random() * frases.length)];
        this._frasesAtivas.push({
            texto,
            x: 60 + Math.random() * 280,
            y: 30 + Math.random() * 230,
            vida: 2 + Math.random() * 1.5,
            vidaMax: 3.5,
            tamanho: 10 + Math.random() * 6,
        });
    },

    _quebrarTexto(ctx, texto, maxW) {
        const palavras = texto.split(" ");
        const linhas = [];
        let atual = "";
        for (const p of palavras) {
            const teste = atual ? atual + " " + p : p;
            if (ctx.measureText(teste).width <= maxW) {
                atual = teste;
            } else {
                if (atual) linhas.push(atual);
                atual = p;
            }
        }
        if (atual) linhas.push(atual);
        return linhas;
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        const serCfg = this._extras.ser;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        // Desenha o frame atual do "ser"
        // Origem: CENTRO do sprite — x,y no JSON = ponto central do NPC.
        // Consistente com o pos do debug (que também mostra o centro do player).
        if (this._serFrames.length > 0) {
            const frame = this._serFrames[this._frameAtual];
            if (frame && frame.naturalWidth > 0) {
                const tam = serCfg?.tamanho ?? frame.naturalWidth;
                ctx.drawImage(frame, serCfg.x - tam / 2, serCfg.y - tam / 2, tam, tam);
            }
        }

        // Overlay de escuridão
        if (this._escuridao > 0) {
            ctx.fillStyle = `rgba(0, 0, 0, ${this._escuridao})`;
            ctx.fillRect(0, 0, w, h);
        }

        // Frases — clip garante que não sangram fora do canvas
        if (this._frasesAtivas.length > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, w, h);
            ctx.clip();
            ctx.textAlign = "center";
            for (const f of this._frasesAtivas) {
                const alpha = Math.min(1, f.vida / f.vidaMax) * 0.7;
                ctx.font = `${f.tamanho}px monospace`;
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fillText(f.texto, f.x, f.y);
            }
            ctx.restore();
        }

        // Zona segura + posição do NPC no debug
        if (window.SALA33_DEBUG) {
            const z = this._extras.zonaSegura;
            ctx.save();
            ctx.strokeStyle = "#00ff66";
            ctx.lineWidth = 1;
            ctx.strokeRect(z.x, z.y, z.w, z.h);
            ctx.fillStyle = "rgba(0, 255, 100, 0.08)";
            ctx.fillRect(z.x, z.y, z.w, z.h);
            ctx.fillStyle = "#00ff66";
            ctx.font = "8px monospace";
            ctx.textAlign = "left";
            ctx.fillText("ZONA SEGURA", z.x + 2, z.y + 9);

            // Marca o ponto x,y do NPC (canto superior esquerdo do sprite)
            if (serCfg) {
                ctx.strokeStyle = "#ff44ff";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(serCfg.x - 6, serCfg.y);
                ctx.lineTo(serCfg.x + 6, serCfg.y);
                ctx.moveTo(serCfg.x, serCfg.y - 6);
                ctx.lineTo(serCfg.x, serCfg.y + 6);
                ctx.stroke();
                ctx.fillStyle = "#ff44ff";
                ctx.fillText(`NPC (${serCfg.x},${serCfg.y})`, serCfg.x + 4, serCfg.y - 3);
            }
            ctx.restore();
        }

        // Caixa de diálogo com word-wrap
        if (this._emDialogo && serCfg) {
            const boxH = 88;
            const boxX = 10;
            const boxY = h - boxH - 10;
            const boxW = w - 20;
            const innerX = boxX + 10;
            const maxLargura = boxW - 20;

            ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
            ctx.fillRect(boxX, boxY, boxW, boxH);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
            ctx.lineWidth = 1;
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            ctx.fillStyle = "white";
            ctx.font = "12px monospace";
            ctx.textAlign = "left";

            const linha = serCfg.dialogo[this._dialogoIndex] ?? "";
            const linhas = this._quebrarTexto(ctx, linha, maxLargura);
            linhas.forEach((l, i) => {
                ctx.fillText(l, innerX, boxY + 20 + i * 16);
            });

            ctx.font = "9px monospace";
            ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
            ctx.fillText("[E] continuar", innerX, boxY + boxH - 8);
        }
    },
});
