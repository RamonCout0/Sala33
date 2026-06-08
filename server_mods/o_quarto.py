# Mecânica: Duelo de Aura (sala "o_quarto")
# Dois jogadores apertam barra de espaço o mais rápido possível.
# A aura decai 0.1 por tick (60fps). Quem chega a 7000 primeiro vence.

import json

HANDLES = ["interagir_aura", "spam_aura", "sair_aura"]
SALA = "o_quarto"

STATE = {
    "p1_ws": None, "p2_ws": None,
    "p1_poder": 0, "p2_poder": 0,
    "ativo": False,
}


def _reset_total():
    STATE["ativo"] = False
    STATE["p1_poder"] = 0
    STATE["p2_poder"] = 0


def on_leave(websocket, JOGADORES):
    if websocket == STATE["p1_ws"] or websocket == STATE["p2_ws"]:
        if websocket == STATE["p1_ws"]:
            STATE["p1_ws"] = None
        if websocket == STATE["p2_ws"]:
            STATE["p2_ws"] = None
        _reset_total()


async def tick(JOGADORES, SALAS, enviar_para_sala):
    if not STATE["ativo"]:
        return

    STATE["p1_poder"] = max(0, STATE["p1_poder"] - 0.1)
    STATE["p2_poder"] = max(0, STATE["p2_poder"] - 0.1)

    p1_sprite = JOGADORES[STATE["p1_ws"]]["spriteId"] if STATE["p1_ws"] in JOGADORES else "cinzaguy"
    p2_sprite = JOGADORES[STATE["p2_ws"]]["spriteId"] if STATE["p2_ws"] in JOGADORES else "cinzaguy"

    for ws in list(SALAS.get(SALA, set())):
        if ws in JOGADORES:
            payload = {
                "tipo": "atualizacao_aura",
                "voce_esta_jogando": (ws == STATE["p1_ws"] or ws == STATE["p2_ws"]),
                "sou_p1": (ws == STATE["p1_ws"]),
                "estado": {
                    "p1_poder": STATE["p1_poder"],
                    "p2_poder": STATE["p2_poder"],
                    "p1_sprite": p1_sprite,
                    "p2_sprite": p2_sprite,
                },
            }
            try:
                JOGADORES[ws]["queue"].put_nowait(json.dumps(payload))
            except Exception:
                pass


async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
    if tipo == "interagir_aura":
        voce_sentou = False
        sou_p1 = False

        if not STATE["p1_ws"]:
            STATE["p1_ws"] = websocket
            JOGADORES[websocket]["x"] = 175
            JOGADORES[websocket]["y"] = 265
            JOGADORES[websocket]["lado"] = "direita"
            STATE["ativo"] = True
            voce_sentou = True
            sou_p1 = True
        elif not STATE["p2_ws"] and STATE["p1_ws"] != websocket:
            STATE["p2_ws"] = websocket
            JOGADORES[websocket]["x"] = 240
            JOGADORES[websocket]["y"] = 265
            JOGADORES[websocket]["lado"] = "esquerda"
            STATE["ativo"] = True
            STATE["p1_poder"] = 0
            STATE["p2_poder"] = 0
            voce_sentou = True

        if voce_sentou:
            await enviar_para_sala(SALA, {
                "tipo": "movimento", "id": id(websocket),
                "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
                "lado": JOGADORES[websocket]["lado"],
            })
            try:
                JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                    "tipo": "atualizacao_aura",
                    "voce_esta_jogando": True,
                    "sou_p1": sou_p1,
                    "meu_x": JOGADORES[websocket]["x"],
                    "meu_y": JOGADORES[websocket]["y"],
                    "meu_lado": JOGADORES[websocket]["lado"],
                    "estado": {
                        "p1_poder": STATE["p1_poder"],
                        "p2_poder": STATE["p2_poder"],
                        "p1_sprite": JOGADORES[websocket]["spriteId"],
                        "p2_sprite": "cinzaguy",
                    },
                }))
            except Exception:
                pass

    elif tipo == "spam_aura":
        if not STATE["ativo"]:
            return
        if websocket == STATE["p1_ws"]:
            STATE["p1_poder"] += 15
            if STATE["p1_poder"] >= 7000:
                await enviar_para_sala(SALA, {"tipo": "chat", "username": "SISTEMA", "texto": "P1 VENCEU O DUELO DE AURA!"})
                on_leave(websocket, JOGADORES)
        elif websocket == STATE["p2_ws"]:
            STATE["p2_poder"] += 15
            if STATE["p2_poder"] >= 7000:
                await enviar_para_sala(SALA, {"tipo": "chat", "username": "SISTEMA", "texto": "P2 VENCEU O DUELO DE AURA!"})
                on_leave(websocket, JOGADORES)

    elif tipo == "sair_aura":
        on_leave(websocket, JOGADORES)
        try:
            JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                "tipo": "atualizacao_aura",
                "voce_esta_jogando": False,
                "estado": {"p1_poder": 0, "p2_poder": 0, "p1_sprite": "cinzaguy", "p2_sprite": "cinzaguy"},
            }))
        except Exception:
            pass
