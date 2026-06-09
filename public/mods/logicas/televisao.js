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

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        // Granulado num canvas auxiliar para não sobrescrever os jogadores
        const offscreen = document.createElement("canvas");
        offscreen.width = w; offscreen.height = h;
        const octx = offscreen.getContext("2d");
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
        ctx.drawImage(offscreen, 0, 0);

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