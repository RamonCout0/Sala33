SALA33_REGISTRAR("sonhos_1", {
    _extras: null,
    _foraDaZona: false,
    _escuridao: 0,
    _frasesAtivas: [],
    _timerProximaFrase: 0,

    onEnter(salaConfig) {
        this._extras = salaConfig.extras || {};
        this._escuridao = 0;
        this._frasesAtivas = [];
        this._foraDaZona = false;
        this._timerProximaFrase = 0;
    },

    onSair() {
        this._frasesAtivas = [];
        this._escuridao = 0;
    },

    onMensagem() { return false; },
    onTeclaDown() { return false; },

    onFisica(meuBicho, ws, teclas) {
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

        return { bloqueiaMovimento: false, tremor: this._foraDaZona ? this._escuridao * 1.5 : 0 };
    },

    _spawnFrase() {
        const frases = this._extras.frasesEco || [];
        if (frases.length === 0) return;

        const texto = frases[Math.floor(Math.random() * frases.length)];
        // x e y dentro de margens seguras — o clip no render() garante o resto
        this._frasesAtivas.push({
            texto,
            x: 60 + Math.random() * 280,
            y: 30 + Math.random() * 230,
            vida: 2 + Math.random() * 1.5,
            vidaMax: 3.5,
            tamanho: 10 + Math.random() * 6,
        });
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        if (this._escuridao <= 0 && this._frasesAtivas.length === 0) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        // Overlay escuro
        ctx.fillStyle = `rgba(0, 0, 0, ${this._escuridao})`;
        ctx.fillRect(0, 0, w, h);

        // Clip garante que frases longas não sangram fora do canvas
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

        // Zona segura visível no modo debug
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
            ctx.restore();
        }
    },
});
