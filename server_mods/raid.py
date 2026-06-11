# Mecânica: Raid — Boss com sopro de dragão
# Ciclo: IDLE → CARREGANDO → ATAQUE → RESET → IDLE

import json

HANDLES = ["esquivar_raid"]
SALA    = "raid"

TEMPO_IDLE       = 3.0
TEMPO_CARREGANDO = 4.0
TEMPO_ATAQUE     = 0.6
TEMPO_RESET      = 1.5
TICK             = 1 / 60

ZONA_SEGURA = {"x": 5, "y": 100, "w":56, "h":110}

STATE = {
    "fase":      "idle",
    "timer":     0.0,
    "progresso": 0.0,
    "esquivaram": set(),
    "spawn": {"x": 184, "y": 210},
}


def _na_zona_segura(jogador):
    z = ZONA_SEGURA
    return (z["x"] <= jogador["x"] <= z["x"] + z["w"] and
            z["y"] <= jogador["y"] <= z["y"] + z["h"])


async def _broadcast(SALAS, JOGADORES, payload):
    msg = json.dumps(payload)
    for ws in list(SALAS.get(SALA, set())):
        if ws in JOGADORES:
            try:
                JOGADORES[ws]["queue"].put_nowait(msg)
            except Exception:
                pass


def on_leave(websocket, JOGADORES):
    STATE["esquivaram"].discard(websocket)


async def tick(JOGADORES, SALAS, enviar_para_sala):
    if not SALAS.get(SALA):
        return

    STATE["timer"] += TICK

    # ── IDLE ──────────────────────────────────────────
    if STATE["fase"] == "idle":
        if STATE["timer"] >= TEMPO_IDLE:
            STATE["fase"]      = "carregando"
            STATE["timer"]     = 0.0
            STATE["progresso"] = 0.0
            STATE["esquivaram"] = set()
            await _broadcast(SALAS, JOGADORES, {
                "tipo": "raid_boss",
                "fase": "carregando",
                "progresso": 0.0,
            })

    # ── CARREGANDO ────────────────────────────────────
    elif STATE["fase"] == "carregando":
        STATE["progresso"] = min(STATE["timer"] / TEMPO_CARREGANDO, 1.0)

        if int(STATE["timer"] * 60) % 6 == 0:
            await _broadcast(SALAS, JOGADORES, {
                "tipo": "raid_boss",
                "fase": "carregando",
                "progresso": STATE["progresso"],
            })

        if STATE["timer"] >= TEMPO_CARREGANDO:
            STATE["fase"]  = "ataque"
            STATE["timer"] = 0.0

            for ws in list(SALAS.get(SALA, set())):
                if ws not in JOGADORES:
                    continue
                j = JOGADORES[ws]
                if ws not in STATE["esquivaram"] and not _na_zona_segura(j):
                    j["x"] = STATE["spawn"]["x"]
                    j["y"] = STATE["spawn"]["y"]
                    await enviar_para_sala(SALA, {
                        "tipo": "movimento",
                        "id":   id(ws),
                        "x":    STATE["spawn"]["x"],
                        "y":    STATE["spawn"]["y"],
                        "lado": "direita",
                    })

            await _broadcast(SALAS, JOGADORES, {
                "tipo": "raid_boss",
                "fase": "ataque",
            })

    # ── ATAQUE ────────────────────────────────────────
    elif STATE["fase"] == "ataque":
        if STATE["timer"] >= TEMPO_ATAQUE:
            STATE["fase"]  = "reset"
            STATE["timer"] = 0.0
            await _broadcast(SALAS, JOGADORES, {
                "tipo": "raid_boss",
                "fase": "reset",
            })

    # ── RESET ─────────────────────────────────────────
    elif STATE["fase"] == "reset":
        if STATE["timer"] >= TEMPO_RESET:
            STATE["fase"]  = "idle"
            STATE["timer"] = 0.0
            STATE["esquivaram"] = set()
            await _broadcast(SALAS, JOGADORES, {
                "tipo": "raid_boss",
                "fase": "idle",
                "progresso": 0.0,
            })


async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
    if tipo == "esquivar_raid" and STATE["fase"] == "carregando":
        STATE["esquivaram"].add(websocket)
        try:
            JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                "tipo": "raid_esquiva",
                "sucesso": True,
            }))
        except Exception:
            pass