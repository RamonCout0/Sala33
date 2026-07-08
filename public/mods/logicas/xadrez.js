// =====================================================
//   MECÂNICA: XADREZ MULTIPLAYER
//   Sala: xadrez
//   Servidor: server_mods/xadrez.py
// =====================================================
//
//   Controles (só teclado — Enter é reservado pelo chat):
//     Setas .......... move cursor / navega no lobby
//     E ou Espaço .... confirma / seleciona / move peça
//     Q .............. sai do lobby / desiste da partida
//
//   FASE 2: regras completas (xeque/xeque-mate/afogamento, roque,
//   en passant, promoção com escolha, empates), lobby, timer (5/10/30),
//   relógios e ranking Elo.
//   O hitbox do tabuleiro (onde aparece o prompt [E]) fica em
//   public/mods/salas/xadrez.json -> extras.tabuleiro.

const GLIFOS = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
const TIMERS = [5, 10, 30];
const PROMO_OPC = ["Q", "R", "B", "N"];

function _fmtRelogio(seg) {
    seg = Math.max(0, Math.floor(seg));
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}

SALA33_REGISTRAR("xadrez", {
    _ws: null,
    _modo: "fora",                 // "fora" | "lobby" | "jogo"
    _hit: { x: 150, y: 95, w: 100, h: 80 },
    _lobby: { partidas: [], ranking: [] },
    _sel: 0,
    _timerSel: 5,
    _estado: null,
    _cursor: { r: 6, c: 4 },
    _origem: null,
    _promo: null,                  // { de:[r,c], para:[r,c], sel } quando promovendo

    onEnter(salaConfig) {
        if (salaConfig?.extras?.tabuleiro) this._hit = salaConfig.extras.tabuleiro;
        this._modo = "fora";
        this._estado = null;
        this._lobby = { partidas: [], ranking: [] };
        this._origem = null;
        this._promo = null;
        this._cursor = { r: 6, c: 4 };
    },

    onSair() {
        if (this._modo !== "fora" && this._ws?.readyState === 1) {
            this._ws.send(JSON.stringify({ tipo: "xadrez_sair" }));
        }
        this._modo = "fora";
        this._estado = null;
        this._origem = null;
        this._promo = null;
    },

    onMensagem(dados, ws) {
        this._ws = ws;
        if (dados.tipo === "xadrez_lobby") {
            this._lobby = { partidas: dados.partidas || [], ranking: dados.ranking || [] };
            if (this._sel > this._lobby.partidas.length) this._sel = 0;
            return true;
        }
        if (dados.tipo === "xadrez_estado") {
            this._estado = dados;
            if (dados.status === "jogando" || dados.status === "fim") this._modo = "jogo";
            return true;
        }
        return false;
    },

    onTeclaDown(code, ws, meuBicho) {
        this._ws = ws;

        // ── FORA: aproxima do tabuleiro e abre o lobby ──
        if (this._modo === "fora") {
            if (code === "KeyE" && this._perto(meuBicho)) {
                ws.send(JSON.stringify({ tipo: "xadrez_lobby" }));
                this._modo = "lobby";
                this._sel = 0;
                return true;
            }
            return false;
        }

        // ── LOBBY ──
        if (this._modo === "lobby") {
            const nItens = 1 + (this._lobby.partidas?.length || 0);
            if (code === "ArrowUp") { this._sel = (this._sel - 1 + nItens) % nItens; return true; }
            if (code === "ArrowDown") { this._sel = (this._sel + 1) % nItens; return true; }
            if (this._sel === 0 && (code === "ArrowLeft" || code === "ArrowRight")) {
                let i = TIMERS.indexOf(this._timerSel);
                i = (i + (code === "ArrowRight" ? 1 : TIMERS.length - 1)) % TIMERS.length;
                this._timerSel = TIMERS[i];
                return true;
            }
            if (code === "KeyE" || code === "Space") {
                if (this._sel === 0) {
                    ws.send(JSON.stringify({ tipo: "xadrez_criar", timer: this._timerSel }));
                } else {
                    const p = this._lobby.partidas[this._sel - 1];
                    if (p && p.status === "aguardando") {
                        ws.send(JSON.stringify({ tipo: "xadrez_entrar", match_id: p.id }));
                    }
                }
                return true;
            }
            if (code === "KeyQ") {
                ws.send(JSON.stringify({ tipo: "xadrez_sair" }));
                this._modo = "fora";
                return true;
            }
            return true;
        }

        // ── JOGO ──
        if (this._modo === "jogo") {
            const e = this._estado;
            if (!e) return true;

            // Escolha de promoção tem prioridade
            if (this._promo) {
                if (code === "ArrowLeft" || code === "ArrowUp") {
                    this._promo.sel = (this._promo.sel + PROMO_OPC.length - 1) % PROMO_OPC.length;
                    return true;
                }
                if (code === "ArrowRight" || code === "ArrowDown") {
                    this._promo.sel = (this._promo.sel + 1) % PROMO_OPC.length;
                    return true;
                }
                if (code === "KeyE" || code === "Space") {
                    ws.send(JSON.stringify({
                        tipo: "xadrez_mover",
                        de: this._promo.de, para: this._promo.para,
                        promo: PROMO_OPC[this._promo.sel],
                    }));
                    this._promo = null;
                    return true;
                }
                if (code === "KeyQ") { this._promo = null; return true; }
                return true;
            }

            if (e.status === "fim") {
                if (code === "KeyE" || code === "Space" || code === "KeyQ") {
                    ws.send(JSON.stringify({ tipo: "xadrez_lobby" }));
                    this._modo = "lobby";
                    this._estado = null;
                    this._origem = null;
                    this._sel = 0;
                }
                return true;
            }

            const flip = (e.sua_cor === "b");
            const s = flip ? -1 : 1;
            const mover = (dr, dc) => {
                this._cursor.r = Math.max(0, Math.min(7, this._cursor.r + dr));
                this._cursor.c = Math.max(0, Math.min(7, this._cursor.c + dc));
            };
            if (code === "ArrowUp") { mover(-s, 0); return true; }
            if (code === "ArrowDown") { mover(s, 0); return true; }
            if (code === "ArrowLeft") { mover(0, -s); return true; }
            if (code === "ArrowRight") { mover(0, s); return true; }

            if (code === "KeyE" || code === "Space") {
                if (e.turn !== e.sua_cor) return true;
                const cur = { r: this._cursor.r, c: this._cursor.c };
                const pc = e.board[cur.r][cur.c];
                if (!this._origem) {
                    if (pc !== "." && this._corDe(pc) === e.sua_cor) this._origem = cur;
                } else if (this._origem.r === cur.r && this._origem.c === cur.c) {
                    this._origem = null;
                } else if (pc !== "." && this._corDe(pc) === e.sua_cor) {
                    this._origem = cur;
                } else {
                    const peca = e.board[this._origem.r][this._origem.c];
                    const ultLinha = (e.sua_cor === "w") ? 0 : 7;
                    if (peca.toLowerCase() === "p" && cur.r === ultLinha) {
                        // promoção: abre o seletor de peça antes de enviar
                        this._promo = { de: [this._origem.r, this._origem.c], para: [cur.r, cur.c], sel: 0 };
                        this._origem = null;
                    } else {
                        ws.send(JSON.stringify({
                            tipo: "xadrez_mover",
                            de: [this._origem.r, this._origem.c],
                            para: [cur.r, cur.c],
                        }));
                        this._origem = null;
                    }
                }
                return true;
            }
            if (code === "KeyQ") {
                ws.send(JSON.stringify({ tipo: "xadrez_sair" }));
                this._modo = "lobby";
                this._estado = null;
                this._origem = null;
                this._sel = 0;
                return true;
            }
            return true;
        }
        return false;
    },

    onFisica(meuBicho, ws) {
        this._ws = ws;
        return { bloqueiaMovimento: this._modo !== "fora", tremor: 0 };
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        if (this._modo === "fora") { this._renderPrompt(ctx, meuBicho); return; }
        if (this._modo === "lobby") { this._renderLobby(ctx); return; }
        if (this._modo === "jogo") { this._renderJogo(ctx); return; }
    },

    // ── Helpers ──────────────────────────────────────
    _corDe(ch) {
        if (ch === "." || !ch) return null;
        return ch === ch.toUpperCase() ? "w" : "b";
    },

    _perto(meuBicho) {
        const h = this._hit;
        const cx = meuBicho.x + meuBicho.tamanho / 2;
        const cy = meuBicho.y + meuBicho.tamanho / 2;
        const m = 18;
        return cx > h.x - m && cx < h.x + h.w + m && cy > h.y - m && cy < h.y + h.h + m;
    },

    _renderPrompt(ctx, meuBicho) {
        if (!this._perto(meuBicho)) return;
        const h = this._hit;
        const lx = h.x + h.w / 2;
        ctx.save();
        ctx.fillStyle = "#161616"; ctx.fillRect(lx - 42, h.y - 24, 84, 14);
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(lx - 42, h.y - 24, 84, 14);
        ctx.fillStyle = "#00ffcc"; ctx.font = "8px monospace"; ctx.textAlign = "center";
        ctx.fillText("[E] JOGAR XADREZ", lx, h.y - 14);
        ctx.restore();
    },

    _renderLobby(ctx) {
        ctx.save();
        ctx.fillStyle = "rgba(8,8,12,0.92)"; ctx.fillRect(0, 0, 400, 300);
        ctx.strokeStyle = "#00e0ff"; ctx.lineWidth = 1; ctx.strokeRect(6, 6, 388, 288);

        ctx.fillStyle = "#f0f0f0"; ctx.font = "12px monospace"; ctx.textAlign = "center";
        ctx.fillText("♚  XADREZ — LOBBY", 200, 22);

        ctx.textAlign = "left"; ctx.font = "8px monospace";
        ctx.fillStyle = "#9ad"; ctx.fillText("PARTIDAS", 16, 44);

        const itens = [{ criar: true }, ...(this._lobby.partidas || [])];
        let y = 58;
        itens.forEach((p, i) => {
            const sel = (i === this._sel);
            if (sel) { ctx.fillStyle = "rgba(0,224,255,0.18)"; ctx.fillRect(12, y - 9, 180, 13); }
            ctx.fillStyle = sel ? "#00e0ff" : "#cfd6dd";
            if (p.criar) {
                ctx.fillText(`${sel ? "▶ " : "  "}+ CRIAR  [◄ ${this._timerSel} min ►]`, 16, y);
            } else {
                const st = p.status === "aguardando" ? "aguardando" : "em jogo";
                const nome = (p.host || "???").slice(0, 8);
                ctx.fillText(`${sel ? "▶ " : "  "}#${p.id} ${nome} ${p.timer}m · ${st}`, 16, y);
            }
            y += 15;
        });
        if ((this._lobby.partidas || []).length === 0) {
            ctx.fillStyle = "#667"; ctx.fillText("(nenhuma sala aberta)", 24, y + 4);
        }

        ctx.fillStyle = "#9ad"; ctx.fillText("RANKING (ELO)", 210, 44);
        let ry = 58;
        (this._lobby.ranking || []).forEach((r, i) => {
            ctx.fillStyle = i === 0 ? "#ffd23f" : "#cfd6dd";
            const nome = (r.nome || "?").slice(0, 9);
            ctx.fillText(`${i + 1}. ${nome}`, 210, ry);
            ctx.textAlign = "right";
            ctx.fillText(`${r.elo}  ${r.v}/${r.d}/${r.e}`, 388, ry);
            ctx.textAlign = "left";
            ry += 14;
        });
        if ((this._lobby.ranking || []).length === 0) {
            ctx.fillStyle = "#667"; ctx.fillText("(sem partidas ainda)", 210, ry);
        }

        ctx.fillStyle = "#778"; ctx.font = "7px monospace"; ctx.textAlign = "center";
        ctx.fillText("↑↓ navegar   ←→ timer   [E] confirmar   [Q] sair", 200, 286);
        ctx.restore();
    },

    _renderJogo(ctx) {
        const e = this._estado;
        ctx.save();
        ctx.fillStyle = "rgba(8,8,12,0.94)"; ctx.fillRect(0, 0, 400, 300);

        const flip = (e.sua_cor === "b");
        const bx = 12, by = 40, sq = 24;        // 8*24 = 192px
        const px = (c) => bx + (flip ? 7 - c : c) * sq;
        const py = (r) => by + (flip ? 7 - r : r) * sq;

        // Casas
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                ctx.fillStyle = ((r + c) % 2 === 0) ? "#cdd3da" : "#5b626b";
                ctx.fillRect(px(c), py(r), sq, sq);
            }
        }

        // Destaque do último lance
        if (e.ultimo) {
            ctx.fillStyle = "rgba(255,210,63,0.28)";
            for (const [r, c] of e.ultimo) ctx.fillRect(px(c), py(r), sq, sq);
        }

        // Rei em xeque (vermelho)
        if (e.xeque) {
            const rk = this._acharRei(e.board, e.turn);
            if (rk) {
                ctx.fillStyle = "rgba(255,40,80,0.55)";
                ctx.fillRect(px(rk.c), py(rk.r), sq, sq);
            }
        }

        // Origem selecionada
        if (this._origem) {
            ctx.fillStyle = "rgba(124,252,154,0.45)";
            ctx.fillRect(px(this._origem.c), py(this._origem.r), sq, sq);
        }

        // Cursor
        {
            const cx = px(this._cursor.c), cy = py(this._cursor.r);
            ctx.strokeStyle = "#00e0ff"; ctx.lineWidth = 2;
            ctx.strokeRect(cx + 1, cy + 1, sq - 2, sq - 2);
        }

        // Peças
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "19px serif";
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const ch = e.board[r][c];
                if (ch === ".") continue;
                this._glifo(ctx, ch, px(c) + sq / 2, py(r) + sq / 2 + 1);
            }
        }
        ctx.textBaseline = "alphabetic";

        // Painel direito: relógios, nomes, vez
        const rx = 214;
        const advCor = flip ? "w" : "b";
        const eu = e.sua_cor;
        const nome = (cor) => ((cor === "w" ? e.w_name : e.b_name) || "???").slice(0, 10);
        const relogio = (cor) => _fmtRelogio(cor === "w" ? e.clock_w : e.clock_b);

        const drawRel = (cor, yy, rotulo) => {
            const ativo = (e.turn === cor && e.status === "jogando");
            ctx.fillStyle = ativo ? "#00e0ff" : "#23272e";
            ctx.fillRect(rx, yy, 174, 30);
            ctx.strokeStyle = "#3a4048"; ctx.lineWidth = 1; ctx.strokeRect(rx, yy, 174, 30);
            ctx.textAlign = "left"; ctx.font = "8px monospace";
            ctx.fillStyle = ativo ? "#04222a" : "#9aa3ad";
            ctx.fillText(`${rotulo}  ${nome(cor)}`, rx + 6, yy + 12);
            ctx.font = "15px monospace";
            ctx.fillStyle = ativo ? "#04222a" : "#e6ebf0";
            ctx.fillText(relogio(cor), rx + 6, yy + 26);
        };
        drawRel(advCor, 40, advCor === eu ? "VOCÊ" : "ADV");
        drawRel(eu, 202, "VOCÊ");

        ctx.textAlign = "center"; ctx.font = "8px monospace";
        if (e.status === "jogando") {
            const minhaVez = (e.turn === eu);
            if (e.xeque) {
                ctx.fillStyle = "#ff5577"; ctx.font = "10px monospace";
                ctx.fillText("XEQUE!", rx + 87, 250);
            } else {
                ctx.fillStyle = minhaVez ? "#7CFC9A" : "#cca";
                ctx.fillText(minhaVez ? "SUA VEZ" : "vez do adversário", rx + 87, 250);
            }
            ctx.fillStyle = "#778"; ctx.font = "7px monospace";
            ctx.fillText("[E] mover  [Q] desistir", rx + 87, 264);
        }

        // Seletor de promoção
        if (this._promo) {
            ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(60, 120, 280, 60);
            ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.strokeRect(60, 120, 280, 60);
            ctx.fillStyle = "#ffd23f"; ctx.font = "9px monospace"; ctx.textAlign = "center";
            ctx.fillText("PROMOÇÃO — escolha (←→ , [E])", 200, 134);
            ctx.textBaseline = "middle"; ctx.font = "22px serif";
            PROMO_OPC.forEach((op, i) => {
                const x = 95 + i * 70;
                const selrt = (i === this._promo.sel);
                ctx.fillStyle = selrt ? "rgba(255,210,63,0.3)" : "rgba(255,255,255,0.06)";
                ctx.fillRect(x - 18, 145, 36, 28);
                if (selrt) { ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 1.5; ctx.strokeRect(x - 18, 145, 36, 28); }
                const ch = (eu === "w") ? op : op.toLowerCase();
                this._glifo(ctx, ch, x, 160);
            });
            ctx.textBaseline = "alphabetic";
        }

        // Banner de fim
        if (e.status === "fim") {
            const venceu = (e.winner === eu);
            const empate = (e.winner === "empate" || !e.winner);
            ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fillRect(40, 110, 320, 80);
            ctx.strokeStyle = venceu ? "#7CFC9A" : (empate ? "#ffd23f" : "#ff5577"); ctx.lineWidth = 2;
            ctx.strokeRect(40, 110, 320, 80);
            ctx.textAlign = "center"; ctx.font = "18px monospace"; ctx.textBaseline = "alphabetic";
            ctx.fillStyle = empate ? "#ffd23f" : (venceu ? "#7CFC9A" : "#ff5577");
            ctx.fillText(empate ? "EMPATE" : (venceu ? "VITÓRIA!" : "DERROTA"), 200, 142);
            ctx.font = "9px monospace"; ctx.fillStyle = "#cfd6dd";
            ctx.fillText(`(${e.motivo || ""})`, 200, 160);
            ctx.fillText("[E] voltar ao lobby", 200, 178);
        }
        ctx.restore();
    },

    _glifo(ctx, ch, x, y) {
        const g = GLIFOS[ch.toLowerCase()];
        if (!g) return;
        const branca = (ch === ch.toUpperCase());
        ctx.fillStyle = branca ? "#f4f4f4" : "#141414";
        ctx.strokeStyle = branca ? "#222" : "#bbb";
        ctx.lineWidth = 0.6;
        ctx.strokeText(g, x, y);
        ctx.fillText(g, x, y);
    },

    _acharRei(board, cor) {
        const rei = (cor === "w") ? "K" : "k";
        for (let r = 0; r < 8; r++) {
            const idx = board[r].indexOf(rei);
            if (idx >= 0) return { r, c: idx };
        }
        return null;
    },
});
