SALA33_REGISTRAR("aquario", {
    _bolhas: [],
    _tempo: 0,      // em ticks (incrementa +1 por frame)
    _extras: null,

    onEnter(salaConfig) {
        this._extras = salaConfig.extras || {};
        this._tempo = 0;
        this._bolhas = [];

        const qtd = this._extras.bolhas?.qtd ?? 12;
        for (let i = 0; i < qtd; i++) {
            this._bolhas.push(this._criarBolha(true));
        }
    },

    onSair() {
        this._bolhas = [];
    },

    _criarBolha(posInicialAleatoria) {
        const cfg = this._extras.bolhas || {};
        const vMin = cfg.velocidadeMin ?? 0.3;
        const vMax = cfg.velocidadeMax ?? 1.2;
        const tMin = cfg.tamanhoMin ?? 2;
        const tMax = cfg.tamanhoMax ?? 6;

        return {
            x: Math.random() * 400,
            y: posInicialAleatoria ? Math.random() * 300 : 300 + Math.random() * 20,
            r: tMin + Math.random() * (tMax - tMin),
            vel: vMin + Math.random() * (vMax - vMin),
            oscilaFase: Math.random() * Math.PI * 2,
        };
    },

    onMensagem() { return false; },
    onTeclaDown() { return false; },

    onFisica(meuBicho, ws, teclas) {
        // +1 por tick (60 ticks/s). Evita instabilidade do 1/60 acumulado.
        this._tempo += 1;

        for (const b of this._bolhas) {
            b.y -= b.vel;
            if (b.y < -b.r) {
                Object.assign(b, this._criarBolha(false));
            }
        }

        return { bloqueiaMovimento: false, tremor: 0 };
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        // Balanço suave em ticks: 0.03 rad/tick ≈ 1.8 rad/s → ondulação lenta
        const balanco = Math.sin(this._tempo * 0.03) * 1.5;

        ctx.save();
        ctx.translate(balanco, 0);

        // Overlay azulado
        ctx.fillStyle = "rgba(10, 60, 100, 0.18)";
        ctx.fillRect(-2, 0, w + 4, h);

        // Bolhas — oscilação lateral: 0.033 rad/tick ≈ 2 rad/s (mantém velocidade original)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        for (const b of this._bolhas) {
            const xOsc = b.x + Math.sin(this._tempo * 0.033 + b.oscilaFase) * 3;
            ctx.beginPath();
            ctx.arc(xOsc, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    },
});
