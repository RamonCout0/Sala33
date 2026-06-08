// =====================================================
//   MECÂNICA: GALERIA DE ARTE
//   Sala: museu
//   (Sem lógica de servidor — tudo é puramente client-side)
// =====================================================

SALA33_REGISTRAR("museu", {
    _obraVisivel: null,
    _quadros: [],
    _imagensObras: {},

    onEnter(salaConfig) {
        this._quadros = salaConfig?.extras?.quadros || [];
        this._obraVisivel = null;
        // Pré-carrega as imagens das obras
        this._imagensObras = {};
        for (const q of this._quadros) {
            const img = new Image();
            img.src = q.imagem;
            this._imagensObras[q.id] = img;
        }
    },

    onSair() {
        this._obraVisivel = null;
    },

    onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual) {
        return false; // Museu não tem tráfego de servidor próprio
    },

    onTeclaDown(code, ws, meuBicho) {
        if (code === "KeyE") {
            if (this._obraVisivel) { this._obraVisivel = null; return true; }
            const cx = meuBicho.x + meuBicho.tamanho / 2;
            const cy = meuBicho.y + meuBicho.tamanho / 2;
            for (const q of this._quadros) {
                if (Math.abs(cx - (q.x + q.w/2)) < 45 && cy > q.y && cy < q.y + 110) {
                    this._obraVisivel = q;
                    return true;
                }
            }
        }
        if (code === "KeyQ" && this._obraVisivel) {
            this._obraVisivel = null;
            return true;
        }
        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        return { bloqueiaMovimento: !!this._obraVisivel, tremor: 0 };
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        const cx = meuBicho.x + tamSprite / 2;
        const cy = meuBicho.y + tamSprite / 2;

        // Hints de interação
        if (!this._obraVisivel) {
            for (const q of this._quadros) {
                if (Math.abs(cx - (q.x + q.w/2)) < 45 && cy > q.y && cy < q.y + 110) {
                    ctx.fillStyle = "#161616"; ctx.fillRect(q.x + q.w/2 - 35, q.y - 15, 70, 14);
                    ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(q.x + q.w/2 - 35, q.y - 15, 70, 14);
                    ctx.fillStyle = "#00ffcc"; ctx.font = "7px monospace"; ctx.textAlign = "center";
                    ctx.fillText("[E] OBSERVAR", q.x + q.w/2, q.y - 5);
                    break;
                }
            }
            return;
        }

        // Overlay da obra
        ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0, 0, 400, 300);
        const mw = 280, mh = 180;
        const mx = (400 - mw) / 2;
        const my = (300 - mh) / 2 - 15;
        ctx.fillStyle = "#111111"; ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.strokeRect(mx, my, mw, mh);

        const img = this._imagensObras[this._obraVisivel.id];
        if (img?.complete && img.naturalWidth !== 0) {
            ctx.drawImage(img, mx + 10, my + 10, mw - 20, mh - 20);
        }

        ctx.fillStyle = "#161616"; ctx.fillRect(mx + 40, my + mh - 5, mw - 80, 20);
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(mx + 40, my + mh - 5, mw - 80, 20);
        ctx.fillStyle = "#FFFFFF"; ctx.font = "10px monospace"; ctx.textAlign = "center";
        ctx.fillText(this._obraVisivel.titulo, 200, my + mh + 8);
        ctx.fillStyle = "#ff2255"; ctx.font = "8px monospace";
        ctx.fillText("[E] ou [Q] PARA FECHAR A GALERIA", 200, my + mh + 28);
    },
});
