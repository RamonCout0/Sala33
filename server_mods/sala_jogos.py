# Mecânica: Pong Multiplayer (sala "sala_jogos")
# A física da bola roda no servidor a 60fps e o resultado é transmitido
# para todos os jogadores da sala.

import json
import random

HANDLES = ["interagir_pong", "comando_pong", "sair_pong"]
SALA = "sala_jogos"

STATE = {
    "p1_ws": None, "p2_ws": None,
    "p1_y": 60, "p2_y": 60,
    "bola_x": 100, "bola_y": 75,
    "bola_dx": 0, "bola_dy": 0,
    "p1_score": 0, "p2_score": 0,
    "ativo": False,
}


def _reset_bola():
    STATE["bola_x"] = 100
    STATE["bola_y"] = 75
    STATE["bola_dx"] = 2.5 if random.choice([True, False]) else -2.5
    STATE["bola_dy"] = 1.2 if random.choice([True, False]) else -1.2


def _reset_total():
    STATE["ativo"] = False
    STATE["p1_score"] = 0
    STATE["p2_score"] = 0
    STATE["p1_y"] = 60
    STATE["p2_y"] = 60
    STATE["bola_x"] = 100
    STATE["bola_y"] = 75
    STATE["bola_dx"] = 0
    STATE["bola_dy"] = 0


def on_leave(websocket, JOGADORES):
    if websocket == STATE["p1_ws"] or websocket == STATE["p2_ws"]:
        if websocket == STATE["p1_ws"]:
            STATE["p1_ws"] = None
        if websocket == STATE["p2_ws"]:
            STATE["p2_ws"] = None
        _reset_total()


async def tick(JOGADORES, SALAS, enviar_para_sala):
    if STATE["ativo"]:
        STATE["bola_x"] += STATE["bola_dx"]
        STATE["bola_y"] += STATE["bola_dy"]

        if STATE["bola_y"] <= 2 or STATE["bola_y"] >= 146:
            STATE["bola_dy"] *= -1

        if STATE["bola_x"] <= 10:
            if STATE["p1_y"] <= STATE["bola_y"] <= STATE["p1_y"] + 25:
                STATE["bola_dx"] = abs(STATE["bola_dx"]) * 1.05
                STATE["bola_dy"] = ((STATE["bola_y"] - (STATE["p1_y"] + 12.5)) / 12.5) * 2
            else:
                STATE["p2_score"] += 1
                _reset_bola()

        if STATE["bola_x"] >= 190:
            if STATE["p2_y"] <= STATE["bola_y"] <= STATE["p2_y"] + 25:
                STATE["bola_dx"] = -abs(STATE["bola_dx"]) * 1.05
                STATE["bola_dy"] = ((STATE["bola_y"] - (STATE["p2_y"] + 12.5)) / 12.5) * 2
            else:
                STATE["p1_score"] += 1
                _reset_bola()

    payload = {
        "tipo": "atualizacao_pong",
        "estado": {
            "p1_y": int(STATE["p1_y"]),
            "p2_y": int(STATE["p2_y"]),
            "bola_x": int(STATE["bola_x"]),
            "bola_y": int(STATE["bola_y"]),
            "p1_score": STATE["p1_score"],
            "p2_score": STATE["p2_score"],
        },
    }
    for ws in list(SALAS.get(SALA, set())):
        if ws in JOGADORES:
            payload["voce_esta_jogando"] = (ws == STATE["p1_ws"] or ws == STATE["p2_ws"])
            try:
                JOGADORES[ws]["queue"].put_nowait(json.dumps(payload))
            except Exception:
                pass


async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
    if tipo == "interagir_pong":
        voce_sentou = False
        if not STATE["p1_ws"]:
            STATE["p1_ws"] = websocket
            JOGADORES[websocket]["x"] = 185
            JOGADORES[websocket]["y"] = 205
            JOGADORES[websocket]["lado"] = "direita"
            voce_sentou = True
        elif not STATE["p2_ws"] and STATE["p1_ws"] != websocket:
            STATE["p2_ws"] = websocket
            JOGADORES[websocket]["x"] = 270
            JOGADORES[websocket]["y"] = 205
            JOGADORES[websocket]["lado"] = "esquerda"
            voce_sentou = True

        if voce_sentou:
            await enviar_para_sala(SALA, {
                "tipo": "movimento", "id": id(websocket),
                "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
                "lado": JOGADORES[websocket]["lado"],
            })
            if STATE["p1_ws"] and STATE["p2_ws"] and not STATE["ativo"]:
                STATE["ativo"] = True
                STATE["p1_score"] = 0
                STATE["p2_score"] = 0
                _reset_bola()

            try:
                JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                    "tipo": "atualizacao_pong",
                    "voce_esta_jogando": True,
                    "meu_x": JOGADORES[websocket]["x"],
                    "meu_y": JOGADORES[websocket]["y"],
                    "meu_lado": JOGADORES[websocket]["lado"],
                    "estado": {
                        "p1_y": int(STATE["p1_y"]), "p2_y": int(STATE["p2_y"]),
                        "bola_x": int(STATE["bola_x"]), "bola_y": int(STATE["bola_y"]),
                        "p1_score": STATE["p1_score"], "p2_score": STATE["p2_score"],
                    },
                }))
            except Exception:
                pass

    elif tipo == "comando_pong":
        acao = dados.get("acao")
        if websocket == STATE["p1_ws"]:
            if acao == "subir":
                STATE["p1_y"] = max(0, STATE["p1_y"] - 5)
            elif acao == "descer":
                STATE["p1_y"] = min(115, STATE["p1_y"] + 5)
        elif websocket == STATE["p2_ws"]:
            if acao == "subir":
                STATE["p2_y"] = max(0, STATE["p2_y"] - 5)
            elif acao == "descer":
                STATE["p2_y"] = min(115, STATE["p2_y"] + 5)

    elif tipo == "sair_pong":
        on_leave(websocket, JOGADORES)
        try:
            JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                "tipo": "atualizacao_pong",
                "voce_esta_jogando": False,
                "estado": {"p1_y": 60, "p2_y": 60, "bola_x": 100, "bola_y": 75, "p1_score": 0, "p2_score": 0},
            }))
        except Exception:
            pass
