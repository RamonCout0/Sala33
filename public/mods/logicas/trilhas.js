// =====================================================
//   SALA: CAMPOS (trilhas) — fundo animado em vídeo .mp4
// =====================================================
//
//   O JSON da sala aponta "imagem" pro assets/maps/trilhas.mp4;
//   como a engine só carrega Image() nativamente, o vídeo é
//   desenhado aqui via renderFundo() (atrás dos jogadores).
//   Ver "Ordem de renderização" no MODDING.md.

SALA33_REGISTRAR("trilhas", {
    _video: null,
    _pronto: false,

    onEnter(salaConfig) {
        this._video = document.createElement("video");
        this._video.src = salaConfig.imagemPath;   // assets/maps/trilhas.mp4
        this._video.loop = true;
        this._video.muted = true;                  // obrigatório p/ autoplay
        this._video.playsInline = true;
        this._video.play().catch(() => {});
        this._pronto = false;
        this._video.addEventListener("canplay", () => { this._pronto = true; });
    },

    onSair() {
        if (this._video) {
            this._video.pause();
            this._video.src = "";
            this._video = null;
        }
        this._pronto = false;
    },

    onMensagem() { return false; },
    onTeclaDown() { return false; },
    onFisica() { return { bloqueiaMovimento: false, tremor: 0 }; },

    renderFundo(ctx) {
        if (this._pronto && this._video) {
            ctx.drawImage(this._video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    },
});
