# =====================================================
#   MECÂNICA: XADREZ MULTIPLAYER  (sala "xadrez")
#   Cliente: public/mods/logicas/xadrez.js
# =====================================================
#
#   FASE 2 (completa): regras oficiais de xadrez —
#   lances legais (não pode deixar o próprio rei em xeque),
#   xeque / xeque-mate / afogamento, roque, en passant,
#   promoção com escolha de peça, e empates (50 lances,
#   repetição tripla, material insuficiente). Lobby de
#   partidas, timer 5/10/30, relógios no servidor e
#   ranking Elo persistido em JSON.
#
#   Tabuleiro: lista de 8 listas de chars. Maiúsculas = brancas,
#   minúsculas = pretas, '.' = vazio. Linha 0 = fundo das pretas,
#   linha 7 = fundo das brancas. Brancas movem "pra cima" (linha diminui).

import json
import os
import time

HANDLES = ["xadrez_lobby", "xadrez_criar", "xadrez_entrar", "xadrez_mover", "xadrez_sair"]
SALA = "xadrez"

RANKING_PATH = os.path.join(os.path.dirname(__file__), "xadrez_ranking.json")

POS_INICIAL = [
    "rnbqkbnr",
    "pppppppp",
    "........",
    "........",
    "........",
    "........",
    "PPPPPPPP",
    "RNBQKBNR",
]

# ── Estado global do mod ──────────────────────────────
MATCHES = {}
_next_id = 1
_dirty = False
_last_mono = None
_acc_relogio = 0.0


# ── Ranking (Elo) persistido em arquivo ───────────────
def _load_ranking():
    try:
        with open(RANKING_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_ranking():
    try:
        with open(RANKING_PATH, "w", encoding="utf-8") as f:
            json.dump(RANKING, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


RANKING = _load_ranking()


def _reg(nome):
    return RANKING.setdefault(nome, {"elo": 1000, "v": 0, "d": 0, "e": 0})


def _aplicar_elo(branco, preto, resultado):
    # resultado: 1.0 = brancas vencem, 0.0 = pretas vencem, 0.5 = empate.
    if not branco or not preto or "ANÔNIMO" in (branco, preto) or branco == preto:
        return
    rb, rp = _reg(branco), _reg(preto)
    eb = 1.0 / (1.0 + 10 ** ((rp["elo"] - rb["elo"]) / 400.0))
    ep = 1.0 - eb
    K = 32
    rb["elo"] = round(rb["elo"] + K * (resultado - eb))
    rp["elo"] = round(rp["elo"] + K * ((1.0 - resultado) - ep))
    if resultado == 1.0:
        rb["v"] += 1; rp["d"] += 1
    elif resultado == 0.0:
        rb["d"] += 1; rp["v"] += 1
    else:
        rb["e"] += 1; rp["e"] += 1
    _save_ranking()


# ── Geometria das peças ───────────────────────────────
def _cor(p):
    if p == "." or p == "":
        return None
    return "w" if p.isupper() else "b"


def _dentro(r, c):
    return 0 <= r < 8 and 0 <= c < 8


def _pseudo_movs(board, r, c):
    """Destinos geométricos da peça (sem roque/en passant, sem checar xeque)."""
    p = board[r][c]
    if p == ".":
        return []
    cor = _cor(p)
    t = p.upper()
    movs = []

    def desliza(dirs):
        for dr, dc in dirs:
            r2, c2 = r + dr, c + dc
            while _dentro(r2, c2):
                alvo = board[r2][c2]
                if alvo == ".":
                    movs.append((r2, c2))
                else:
                    if _cor(alvo) != cor:
                        movs.append((r2, c2))
                    break
                r2 += dr; c2 += dc

    if t == "P":
        d = -1 if cor == "w" else 1
        inicio = 6 if cor == "w" else 1
        if _dentro(r + d, c) and board[r + d][c] == ".":
            movs.append((r + d, c))
            if r == inicio and board[r + 2 * d][c] == ".":
                movs.append((r + 2 * d, c))
        for dc in (-1, 1):
            r2, c2 = r + d, c + dc
            if _dentro(r2, c2) and board[r2][c2] != "." and _cor(board[r2][c2]) != cor:
                movs.append((r2, c2))
    elif t == "N":
        for dr, dc in ((1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)):
            r2, c2 = r + dr, c + dc
            if _dentro(r2, c2) and _cor(board[r2][c2]) != cor:
                movs.append((r2, c2))
    elif t == "B":
        desliza([(1, 1), (1, -1), (-1, 1), (-1, -1)])
    elif t == "R":
        desliza([(1, 0), (-1, 0), (0, 1), (0, -1)])
    elif t == "Q":
        desliza([(1, 1), (1, -1), (-1, 1), (-1, -1), (1, 0), (-1, 0), (0, 1), (0, -1)])
    elif t == "K":
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                r2, c2 = r + dr, c + dc
                if _dentro(r2, c2) and _cor(board[r2][c2]) != cor:
                    movs.append((r2, c2))
    return movs


def _ataques_de(board, r, c):
    """Casas atacadas pela peça (peão = só diagonais; resto = movimento)."""
    p = board[r][c]
    if p == ".":
        return []
    if p.upper() == "P":
        d = -1 if _cor(p) == "w" else 1
        return [(r + d, cc) for cc in (c - 1, c + 1) if _dentro(r + d, cc)]
    return _pseudo_movs(board, r, c)


def _atacada(board, r, c, por_cor):
    for rr in range(8):
        for cc in range(8):
            p = board[rr][cc]
            if p != "." and _cor(p) == por_cor and (r, c) in _ataques_de(board, rr, cc):
                return True
    return False


def _achar_rei(board, cor):
    rei = "K" if cor == "w" else "k"
    for r in range(8):
        for c in range(8):
            if board[r][c] == rei:
                return (r, c)
    return None


def _em_xeque(board, cor):
    pos = _achar_rei(board, cor)
    if pos is None:
        return True
    return _atacada(board, pos[0], pos[1], "b" if cor == "w" else "w")


# ── Lances pseudo-legais (com roque + en passant) ─────
def _castling_lances(board, cor, rights):
    out = []
    r = 7 if cor == "w" else 0
    rei = "K" if cor == "w" else "k"
    if board[r][4] != rei or _em_xeque(board, cor):
        return out
    inimigo = "b" if cor == "w" else "w"
    lado_rei = "K" if cor == "w" else "k"
    lado_dama = "Q" if cor == "w" else "q"
    if (lado_rei in rights and board[r][5] == "." and board[r][6] == "."
            and not _atacada(board, r, 5, inimigo) and not _atacada(board, r, 6, inimigo)):
        out.append(((r, 4), (r, 6)))
    if (lado_dama in rights and board[r][1] == "." and board[r][2] == "." and board[r][3] == "."
            and not _atacada(board, r, 3, inimigo) and not _atacada(board, r, 2, inimigo)):
        out.append(((r, 4), (r, 2)))
    return out


def _pseudo_lances(board, cor, rights, ep):
    lances = []
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if p == "." or _cor(p) != cor:
                continue
            for (r2, c2) in _pseudo_movs(board, r, c):
                lances.append(((r, c), (r2, c2)))
            if p.upper() == "P" and ep is not None:
                d = -1 if cor == "w" else 1
                for dc in (-1, 1):
                    if (r + d, c + dc) == ep and _dentro(r + d, c + dc) and board[r + d][c + dc] == ".":
                        lances.append(((r, c), (r + d, c + dc)))
    lances += _castling_lances(board, cor, rights)
    return lances


def _aplica_sim(b, de, para, cor, ep):
    """Aplica um lance num tabuleiro-cópia (promoção vira rainha — irrelevante p/ xeque)."""
    r, c = de
    r2, c2 = para
    p = b[r][c]
    t = p.upper()
    if t == "P" and (r2, c2) == ep and b[r2][c2] == ".":
        b[r][c2] = "."
    b[r2][c2] = p
    b[r][c] = "."
    if t == "P" and (r2 == 0 or r2 == 7):
        b[r2][c2] = "Q" if cor == "w" else "q"
    if t == "K" and abs(c2 - c) == 2:
        if c2 == 6:
            b[r2][5] = b[r2][7]; b[r2][7] = "."
        elif c2 == 2:
            b[r2][3] = b[r2][0]; b[r2][0] = "."


def _legais(board, cor, rights, ep):
    res = []
    for (de, para) in _pseudo_lances(board, cor, rights, ep):
        b2 = [row[:] for row in board]
        _aplica_sim(b2, de, para, cor, ep)
        if not _em_xeque(b2, cor):
            res.append((de, para))
    return res


# ── Execução real de um lance + atualização de estado ─
def _chave(m):
    b = "/".join("".join(row) for row in m["board"])
    return f"{b}|{m['turn']}|{''.join(sorted(m['rights']))}|{m['ep']}"


def _executar(m, de, para, promo):
    board = m["board"]
    r, c = de
    r2, c2 = para
    p = board[r][c]
    cor = _cor(p)
    t = p.upper()
    alvo0 = board[r2][c2]
    eh_ep = (t == "P" and m["ep"] is not None and (r2, c2) == m["ep"] and alvo0 == ".")
    eh_captura = (alvo0 != ".") or eh_ep

    if eh_ep:
        board[r][c2] = "."          # remove o peão capturado en passant
    board[r2][c2] = p
    board[r][c] = "."

    if t == "P" and (r2 == 0 or r2 == 7):
        pp = promo if promo in ("Q", "R", "B", "N") else "Q"
        board[r2][c2] = pp if cor == "w" else pp.lower()

    if t == "K" and abs(c2 - c) == 2:
        if c2 == 6:
            board[r2][5] = board[r2][7]; board[r2][7] = "."
        elif c2 == 2:
            board[r2][3] = board[r2][0]; board[r2][0] = "."

    rights = set(m["rights"])
    if t == "K":
        rights.discard("K" if cor == "w" else "k")
        rights.discard("Q" if cor == "w" else "q")
    cantos = {(7, 0): "Q", (7, 7): "K", (0, 0): "q", (0, 7): "k"}
    if (r, c) in cantos:
        rights.discard(cantos[(r, c)])      # torre saiu do canto
    if (r2, c2) in cantos:
        rights.discard(cantos[(r2, c2)])    # torre capturada no canto
    m["rights"] = rights

    m["ep"] = ((r + r2) // 2, c) if (t == "P" and abs(r2 - r) == 2) else None
    m["halfmove"] = 0 if (t == "P" or eh_captura) else m["halfmove"] + 1
    m["ultimo"] = (de, para)
    m["turn"] = "b" if cor == "w" else "w"
    m["historico"].append(_chave(m))


def _material_insuficiente(board):
    menores = []
    bispos = []
    for r in range(8):
        for c in range(8):
            p = board[r][c]
            if p == ".":
                continue
            u = p.upper()
            if u == "K":
                continue
            if u in ("Q", "R", "P"):
                return False
            menores.append(u)
            if u == "B":
                bispos.append((r + c) % 2)
    if len(menores) == 0:
        return True                         # K vs K
    if len(menores) == 1:
        return True                         # K + bispo/cavalo vs K
    if len(menores) == 2 and len(bispos) == 2 and bispos[0] == bispos[1]:
        return True                         # K+B vs K+B (bispos da mesma cor)
    return False


def _finalizar_se_acabou(m):
    cor = m["turn"]
    if not _legais(m["board"], cor, m["rights"], m["ep"]):
        if _em_xeque(m["board"], cor):
            _terminar(m, "b" if cor == "w" else "w", "xeque-mate")
        else:
            _terminar(m, "empate", "afogamento")
        return
    if m["halfmove"] >= 100:
        _terminar(m, "empate", "50 lances"); return
    if m["historico"].count(_chave(m)) >= 3:
        _terminar(m, "empate", "repetição"); return
    if _material_insuficiente(m["board"]):
        _terminar(m, "empate", "material insuficiente"); return


# ── Helpers de partida ────────────────────────────────
def _clone_inicial():
    return [list(linha) for linha in POS_INICIAL]


def _match_do(ws):
    for m in MATCHES.values():
        if m["w_ws"] is ws or m["b_ws"] is ws:
            return m
    return None


def _pos_valida(p):
    return (isinstance(p, (list, tuple)) and len(p) == 2
            and all(isinstance(x, int) and 0 <= x < 8 for x in p))


def _terminar(m, vencedor, motivo):
    if m["status"] == "fim":
        return
    aplicar = (m["status"] == "jogando")
    m["status"] = "fim"
    m["winner"] = vencedor
    m["motivo"] = motivo
    m["fim_ts"] = time.monotonic()
    if aplicar:
        res = 1.0 if vencedor == "w" else (0.0 if vencedor == "b" else 0.5)
        _aplicar_elo(m["w_name"], m["b_name"], res)


# ── Broadcast ─────────────────────────────────────────
def _send(JOGADORES, ws, payload):
    if ws is not None and ws in JOGADORES:
        try:
            JOGADORES[ws]["queue"].put_nowait(json.dumps(payload))
        except Exception:
            pass


def _lobby_payload():
    partidas = []
    for m in MATCHES.values():
        if m["status"] == "fim":
            continue
        partidas.append({
            "id": m["id"], "host": m["w_name"], "timer": m["timer"],
            "status": m["status"], "cheia": m["status"] != "aguardando",
        })
    rank = sorted(RANKING.items(), key=lambda kv: kv[1].get("elo", 1000), reverse=True)[:8]
    ranking = [{
        "nome": n, "elo": d.get("elo", 1000),
        "v": d.get("v", 0), "d": d.get("d", 0), "e": d.get("e", 0),
    } for n, d in rank]
    return {"tipo": "xadrez_lobby", "partidas": partidas, "ranking": ranking}


def _estado_base(m):
    ult = m.get("ultimo")
    return {
        "tipo": "xadrez_estado",
        "match_id": m["id"],
        "board": ["".join(linha) for linha in m["board"]],
        "turn": m["turn"],
        "clock_w": int(m["clock_w"]),
        "clock_b": int(m["clock_b"]),
        "status": m["status"],
        "winner": m.get("winner"),
        "motivo": m.get("motivo", ""),
        "w_name": m["w_name"],
        "b_name": m["b_name"],
        "xeque": _em_xeque(m["board"], m["turn"]) if m["status"] == "jogando" else False,
        "ultimo": [list(ult[0]), list(ult[1])] if ult else None,
    }


def _enviar_estado(JOGADORES, m):
    base = _estado_base(m)
    if m["w_ws"]:
        _send(JOGADORES, m["w_ws"], dict(base, sua_cor="w"))
    if m["b_ws"]:
        _send(JOGADORES, m["b_ws"], dict(base, sua_cor="b"))


# ── Ciclo de vida ─────────────────────────────────────
def on_leave(websocket, JOGADORES):
    global _dirty
    m = _match_do(websocket)
    if not m:
        return
    if m["status"] == "jogando":
        _terminar(m, "b" if websocket is m["w_ws"] else "w", "abandono")
    elif m["status"] == "aguardando":
        MATCHES.pop(m["id"], None)
    if m.get("w_ws") is websocket:
        m["w_ws"] = None
    if m.get("b_ws") is websocket:
        m["b_ws"] = None
    _dirty = True


async def tick(JOGADORES, SALAS, enviar_para_sala):
    global _last_mono, _acc_relogio, _dirty
    agora = time.monotonic()
    if _last_mono is None:
        _last_mono = agora
    dt = agora - _last_mono
    _last_mono = agora

    if not MATCHES and not _dirty:
        return

    for m in list(MATCHES.values()):
        if m["status"] == "jogando":
            if m["turn"] == "w":
                m["clock_w"] -= dt
                if m["clock_w"] <= 0:
                    m["clock_w"] = 0; _terminar(m, "b", "tempo"); _dirty = True
            else:
                m["clock_b"] -= dt
                if m["clock_b"] <= 0:
                    m["clock_b"] = 0; _terminar(m, "w", "tempo"); _dirty = True
        elif m["status"] == "fim" and agora - m.get("fim_ts", agora) > 15:
            MATCHES.pop(m["id"], None); _dirty = True

    if _dirty:
        if SALA in SALAS:
            await enviar_para_sala(SALA, _lobby_payload())
        for m in MATCHES.values():
            _enviar_estado(JOGADORES, m)
        _dirty = False

    _acc_relogio += dt
    if _acc_relogio >= 0.4:
        _acc_relogio = 0.0
        for m in MATCHES.values():
            if m["status"] == "jogando":
                _enviar_estado(JOGADORES, m)


async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
    global _next_id, _dirty

    if tipo == "xadrez_lobby":
        _send(JOGADORES, websocket, _lobby_payload())
        m = _match_do(websocket)
        if m:
            _enviar_estado(JOGADORES, m)

    elif tipo == "xadrez_criar":
        if _match_do(websocket):
            return
        timer = dados.get("timer", 5)
        if timer not in (5, 10, 30):
            timer = 5
        mid = _next_id
        _next_id += 1
        nome = JOGADORES[websocket]["username"]
        m = {
            "id": mid,
            "w_ws": websocket, "w_name": nome,
            "b_ws": None, "b_name": None,
            "board": _clone_inicial(),
            "turn": "w",
            "timer": timer,
            "clock_w": timer * 60.0,
            "clock_b": timer * 60.0,
            "status": "aguardando",
            "winner": None,
            "motivo": "",
            "rights": set("KQkq"),
            "ep": None,
            "halfmove": 0,
            "ultimo": None,
            "historico": [],
        }
        m["historico"].append(_chave(m))
        MATCHES[mid] = m
        _dirty = True
        _send(JOGADORES, websocket, _lobby_payload())

    elif tipo == "xadrez_entrar":
        m = MATCHES.get(dados.get("match_id"))
        if not m or m["b_ws"] or m["status"] != "aguardando":
            return
        if m["w_ws"] is websocket or _match_do(websocket):
            return
        m["b_ws"] = websocket
        m["b_name"] = JOGADORES[websocket]["username"]
        m["status"] = "jogando"
        _dirty = True

    elif tipo == "xadrez_mover":
        m = _match_do(websocket)
        if not m or m["status"] != "jogando":
            return
        cor = "w" if websocket is m["w_ws"] else "b"
        if m["turn"] != cor:
            return
        de = dados.get("de")
        para = dados.get("para")
        if not (_pos_valida(de) and _pos_valida(para)):
            return
        de = (de[0], de[1]); para = (para[0], para[1])
        if _cor(m["board"][de[0]][de[1]]) != cor:
            return
        if (de, para) not in _legais(m["board"], cor, m["rights"], m["ep"]):
            return
        _executar(m, de, para, dados.get("promo"))
        _finalizar_se_acabou(m)
        _dirty = True

    elif tipo == "xadrez_sair":
        m = _match_do(websocket)
        if m:
            if m["status"] == "jogando":
                _terminar(m, "b" if websocket is m["w_ws"] else "w", "desistência")
            elif m["status"] == "aguardando":
                MATCHES.pop(m["id"], None)
            if m.get("w_ws") is websocket:
                m["w_ws"] = None
            if m.get("b_ws") is websocket:
                m["b_ws"] = None
            _dirty = True
        _send(JOGADORES, websocket, _lobby_payload())
