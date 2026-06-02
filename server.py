import asyncio
import json
import websockets

JOGADORES = {}
SALAS = {
    "the_hub": set(), "museu": set(), "floresta": set(), 
    "o_quarto": set(), "sala_jogos": set()
}

async def enviar_para_sala(sala_nome, payload):
    if not sala_nome or sala_nome not in SALAS or not SALAS[sala_nome]: return
    await asyncio.gather(*[ws.send(json.dumps(payload)) for ws in SALAS[sala_nome]])

async def mover_jogador(websocket, nova_sala):
    sala_antiga = JOGADORES[websocket]["sala"]
    if sala_antiga and websocket in SALAS[sala_antiga]:
        SALAS[sala_antiga].remove(websocket)
        await enviar_para_sala(sala_antiga, {"tipo": "jogador_saiu", "id": id(websocket)})
    
    JOGADORES[websocket]["sala"] = nova_sala
    SALAS[nova_sala].add(websocket)
    
    await enviar_para_sala(nova_sala, {
        "tipo": "novo_jogador", "id": id(websocket),
        "username": JOGADORES[websocket]["username"],
        "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"]
    })

async def handler(websocket):
    JOGADORES[websocket] = {"username": "Anônimo", "sala": None, "x": 200, "y": 150}
    try:
        async for mensagem in websocket:
            dados = json.loads(mensagem)
            sala_atual = JOGADORES[websocket]["sala"]
            
            if dados["tipo"] == "login":
                JOGADORES[websocket]["username"] = dados["username"]
                await mover_jogador(websocket, "the_hub")
                
            elif dados["tipo"] == "mover":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                await enviar_para_sala(sala_atual, {
                    "tipo": "movimento", "id": id(websocket),
                    "x": dados["x"], "y": dados["y"]
                })
                
            elif dados["tipo"] == "mudar_sala":
                await mover_jogador(websocket, dados["nova_sala"])
                
            elif dados["tipo"] == "chat":
                await enviar_para_sala(sala_atual, {
                    "tipo": "chat", "username": JOGADORES[websocket]["username"], "texto": dados["texto"]
                })
                
            # NOTIFICAÇÃO EM TEMPO REAL: Indicador de digitação
            elif dados["tipo"] == "digitando":
                await enviar_para_sala(sala_atual, {
                    "tipo": "jogador_digitando", "id": id(websocket), "estado": dados["estado"]
                })

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        sala_atual = JOGADORES[websocket]["sala"]
        if sala_atual and websocket in SALAS[sala_atual]:
            SALAS[sala_atual].remove(websocket)
            await enviar_para_sala(sala_atual, {"tipo": "jogador_saiu", "id": id(websocket)})
        JOGADORES.pop(websocket, None)

async def main():
    print("Servidor Sala33 rodando em ws://localhost:8080")
    async with websockets.serve(handler, "0.0.0.0", 8080):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())