// =====================================================
//   MECÂNICA: ESTÁTICA DE TV
//   Sala: televisao
// =====================================================

SALA33_REGISTRAR("televisao", {

    onEnter(salaConfig) {},
    onSair() {},
    onMensagem() { return false; },
    onTeclaDown() { return false; },
    onFisica() { return { bloqueiaMovimento: false, tremor: 0 }; },

    // Quadros de ruído pré-gerados (uma vez) e alternados a cada frame.
    // Antes criava um canvas + ImageData novos e sorteava 240 mil números
    // por frame, o que gerava travadas de garbage collector.
    _quadrosRuido: null,
    _quadroAtual: 0,
    _N_QUADROS: 6,

    _gerarRuido(w, h) {
        this._quadrosRuido = [];
        for (let q = 0; q < this._N_QUADROS; q++) {
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const octx = c.getContext("2d");
            const imageData = octx.createImageData(w, h);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const v = Math.random() * 255;
                data[i]     = v;
                data[i + 1] = v;
                data[i + 2] = v;
                data[i + 3] = Math.random() * 60;
            }
            octx.putImageData(imageData, 0, 0);
            this._quadrosRuido.push(c);
        }
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        const q0 = this._quadrosRuido?.[0];
        if (!q0 || q0.width !== w || q0.height !== h) this._gerarRuido(w, h);
        this._quadroAtual = (this._quadroAtual + 1) % this._N_QUADROS;
        ctx.drawImage(this._quadrosRuido[this._quadroAtual], 0, 0);

        // Linhas de varredura horizontais (efeito CRT)
        ctx.save();
        for (let y = 0; y < h; y += 3) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
            ctx.fillRect(0, y, w, 1);
        }

        // Faixa de estática rolando verticalmente
        const faixaY = (Date.now() / 8) % (h + 60) - 30;
        const grad = ctx.createLinearGradient(0, faixaY, 0, faixaY + 60);
        grad.addColorStop(0,   "rgba(255,255,255,0)");
        grad.addColorStop(0.4, "rgba(255,255,255,0.07)");
        grad.addColorStop(0.6, "rgba(255,255,255,0.07)");
        grad.addColorStop(1,   "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, faixaY, w, 60);

        ctx.restore();
    },
});