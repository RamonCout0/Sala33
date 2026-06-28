// =====================================================
//   SALA DE DEMONSTRAÇÃO: FUNDO ANIMADO (vídeo .webm)
//   Sala: fundo_teste
// =====================================================
//
//   Prova prática do hook renderFundo: o vídeo é desenhado em
//   renderFundo() (roda ANTES dos jogadores → fica ATRÁS deles),
//   e um rótulo é desenhado em render() (roda DEPOIS → fica POR CIMA).
//   Ver "Ordem de renderização" no MODDING.md.

SALA33_REGISTRAR("fundo_teste", {
    _video: null,
    _pronto: false,

    onEnter(salaConfig) {
        this._video = document.createElement("video");
        this._video.src = salaConfig.imagemPath;   // aponta pro .webm da sala
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

    // FUNDO: desenhado atrás dos jogadores
    renderFundo(ctx) {
        if (this._pronto && this._video) {
            ctx.drawImage(this._video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    },

    // OVERLAY: desenhado por cima de tudo (prova a ordem de render)
    render(ctx) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(8, 8, 250, 32);
        ctx.strokeStyle = "#00e0ff"; ctx.lineWidth = 1; ctx.strokeRect(8, 8, 250, 32);
        ctx.textAlign = "left"; ctx.font = "8px monospace";
        ctx.fillStyle = "#00e0ff"; ctx.fillText("SALA DE TESTE — fundo .webm via renderFundo()", 14, 21);
        ctx.fillStyle = "#9ad"; ctx.fillText("o boneco fica POR CIMA do fundo animado", 14, 32);
        ctx.restore();
    },
});
