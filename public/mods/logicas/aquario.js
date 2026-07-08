SALA33_REGISTRAR("aquario", {
    _bolhas: [],
    _tempo: 0,      // em ticks (incrementa +1 por frame)
    _extras: null,
    _distorcao: { amplitude: 1.5, velocidade: 0.05 },
    _buf: null,     // canvas offscreen pro snapshot do frame
    _bctx: null,

    onEnter(salaConfig) {
        this._extras = salaConfig.extras || {};
        this._tempo = 0;
        this._bolhas = [];

        // Config do efeito de água (vem do JSON; tem fallback)
        this._distorcao = {
            amplitude:  this._extras.distorcao?.amplitude  ?? 1.5,
            velocidade: this._extras.distorcao?.velocidade ?? 0.05,
        };

        const qtd = this._extras.bolhas?.qtd ?? 12;
        for (let i = 0; i < qtd; i++) {
            this._bolhas.push(this._criarBolha(true));
        }
    },

    onSair() {
        this._bolhas = [];
        this._buf = null;   // libera o canvas offscreen
        this._bctx = null;
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
        const c = ctx.canvas;
        const w = c.width, h = c.height;
        const amp = this._distorcao.amplitude;
        const vel = this._distorcao.velocidade;

        // ── Efeito de água ──────────────────────────────────────────
        // A render() da sala roda DEPOIS dos sprites já desenhados. Então
        // tiramos um snapshot do frame e redesenhamos em faixas horizontais
        // com deslocamento senoidal → refração de água em tudo (cenário + sprites).
        if (!this._buf || this._buf.width !== w || this._buf.height !== h) {
            this._buf = document.createElement("canvas");
            this._buf.width = w;
            this._buf.height = h;
            this._bctx = this._buf.getContext("2d");
        }
        this._bctx.clearRect(0, 0, w, h);
        this._bctx.drawImage(c, 0, 0);   // captura cenário + sprites

        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._buf, 0, 0);  // base sem onda (preenche as bordas, sem buracos)

        const faixa = 3;  // altura de cada fatia (px)
        for (let y = 0; y < h; y += faixa) {
            const dx = Math.sin(y * 0.07 + this._tempo * vel) * amp;
            const sh = Math.min(faixa, h - y);
            ctx.drawImage(this._buf, 0, y, w, sh, dx, y, w, sh);
        }

        // ── Overlay azulado ─────────────────────────────────────────
        ctx.fillStyle = "rgba(10, 60, 100, 0.18)";
        ctx.fillRect(0, 0, w, h);

        // ── Bolhas (com balanço lateral suave) ──────────────────────
        ctx.save();
        const balanco = Math.sin(this._tempo * 0.03) * 1.5;
        ctx.translate(balanco, 0);
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
