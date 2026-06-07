import asyncio
import json
import websockets
import os
import socket
import subprocess
import platform
import threading
import time
import random
from http.server import SimpleHTTPRequestHandler 
from socketserver import TCPServer               

# ==========================================
# CONFIGURAÇÕES DE ESTADO MULTIPLAYER E PONG
# ==========================================
JOGADORES = {}
SALAS = {
    "the_hub": set(), "museu": set(), "floresta": set(), 
    "o_quarto": set(), "sala_jogos": set()
}

PONG_STATE = {
    "p1_ws": None, "p2_ws": None,
    "p1_y": 60, "p2_y": 60,
    "bola_x": 100, "bola_y": 75,
    "bola_dx": 0, "bola_dy": 0, # Começa parada no centro
    "p1_score": 0, "p2_score": 0,
    "ativo": False
}

async def enviar_para_sala(sala_nome, payload):
    if not sala_nome or sala_nome not in SALAS or not SALAS[sala_nome]: 
        return
    mensagem = json.dumps(payload)
    for ws in list(SALAS[sala_nome]):
        if ws in JOGADORES:
            try:
                JOGADORES[ws]["queue"].put_nowait(mensagem)
            except asyncio.QueueFull:
                try:
                    JOGADORES[ws]["queue"].get_nowait()
                    JOGADORES[ws]["queue"].put_nowait(mensagem)
                except Exception:
                    pass

async def loop_fisica_pong():
    global PONG_STATE
    while True:
        await asyncio.sleep(1 / 60)
        
        if PONG_STATE["ativo"]:
            PONG_STATE["bola_x"] += PONG_STATE["bola_dx"]
            PONG_STATE["bola_y"] += PONG_STATE["bola_dy"]
            
            if PONG_STATE["bola_y"] <= 2 or PONG_STATE["bola_y"] >= 146:
                PONG_STATE["bola_dy"] *= -1
                
            if PONG_STATE["bola_x"] <= 10:
                if PONG_STATE["p1_y"] <= PONG_STATE["bola_y"] <= PONG_STATE["p1_y"] + 25:
                    PONG_STATE["bola_dx"] = abs(PONG_STATE["bola_dx"]) * 1.05
                    PONG_STATE["bola_dy"] = ((PONG_STATE["bola_y"] - (PONG_STATE["p1_y"] + 12.5)) / 12.5) * 2
                else:
                    PONG_STATE["p2_score"] += 1
                    reset_bola_pong()
                    
            if PONG_STATE["bola_x"] >= 190:
                if PONG_STATE["p2_y"] <= PONG_STATE["bola_y"] <= PONG_STATE["p2_y"] + 25:
                    PONG_STATE["bola_dx"] = -abs(PONG_STATE["bola_dx"]) * 1.05
                    PONG_STATE["bola_dy"] = ((PONG_STATE["bola_y"] - (PONG_STATE["p2_y"] + 12.5)) / 12.5) * 2
                else:
                    PONG_STATE["p1_score"] += 1
                    reset_bola_pong()

        payload = {
            "tipo": "atualizacao_pong",
            "estado": {
                "p1_y": int(PONG_STATE["p1_y"]), "p2_y": int(PONG_STATE["p2_y"]),
                "bola_x": int(PONG_STATE["bola_x"]), "bola_y": int(PONG_STATE["bola_y"]),
                "p1_score": PONG_STATE["p1_score"], "p2_score": PONG_STATE["p2_score"]
            }
        }
        
        for ws in list(SALAS["sala_jogos"]):
            if ws in JOGADORES:
                payload["voce_esta_jogando"] = (ws == PONG_STATE["p1_ws"] or ws == PONG_STATE["p2_ws"])
                try:
                    JOGADORES[ws]["queue"].put_nowait(json.dumps(payload))
                except Exception:
                    pass

def reset_bola_pong():
    global PONG_STATE
    PONG_STATE["bola_x"] = 100
    PONG_STATE["bola_y"] = 75
    PONG_STATE["bola_dx"] = 2.5 if random.choice([True, False]) else -2.5
    PONG_STATE["bola_dy"] = 1.2 if random.choice([True, False]) else -1.2

# NOVO: Função de Faxina que zera tudo se alguém fugir da partida
def abandonar_pong(ws):
    global PONG_STATE
    mudou = False
    
    if ws == PONG_STATE["p1_ws"]:
        PONG_STATE["p1_ws"] = None
        mudou = True
    elif ws == PONG_STATE["p2_ws"]:
        PONG_STATE["p2_ws"] = None
        mudou = True
        
    if mudou:
        # Alguém saiu! Congela o jogo e reseta o cenário pros próximos
        PONG_STATE["ativo"] = False
        PONG_STATE["p1_score"] = 0
        PONG_STATE["p2_score"] = 0
        PONG_STATE["p1_y"] = 60
        PONG_STATE["p2_y"] = 60
        PONG_STATE["bola_x"] = 100
        PONG_STATE["bola_y"] = 75
        PONG_STATE["bola_dx"] = 0
        PONG_STATE["bola_dy"] = 0

async def mover_jogador(websocket, nova_sala):
    if websocket not in JOGADORES: return
    sala_antiga = JOGADORES[websocket]["sala"]
    
    if sala_antiga and websocket in SALAS[sala_antiga]:
        SALAS[sala_antiga].remove(websocket)
        await enviar_para_sala(sala_antiga, {"tipo": "jogador_saiu", "id": id(websocket)})
        # Se mudou de sala, verifica se estava no Pong e reseta a máquina
        abandonar_pong(websocket) 
    
    usuarios_existentes = []
    for outro_ws in list(SALAS[nova_sala]):
        if outro_ws in JOGADORES:
            usuarios_existentes.append({
                "id": id(outro_ws), "username": JOGADORES[outro_ws]["username"],
                "x": JOGADORES[outro_ws]["x"], "y": JOGADORES[outro_ws]["y"],
                "spriteId": JOGADORES[outro_ws]["spriteId"], "lado": JOGADORES[outro_ws].get("lado", "direita")
            })
    
    if usuarios_existentes and websocket in JOGADORES:
        try: JOGADORES[websocket]["queue"].put_nowait(json.dumps({"tipo": "lista_jogadores", "jogadores": usuarios_existentes}))
        except Exception: pass
    
    if websocket in JOGADORES:
        JOGADORES[websocket]["sala"] = nova_sala
        SALAS[nova_sala].add(websocket)
        await enviar_para_sala(nova_sala, {
            "tipo": "novo_jogador", "id": id(websocket), "username": JOGADORES[websocket]["username"],
            "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
            "spriteId": JOGADORES[websocket]["spriteId"], "lado": JOGADORES[websocket].get("lado", "direita")
        })

async def escritor_cliente(websocket, queue):
    try:
        while True:
            mensagem = await queue.get()
            await websocket.send(mensagem)
            queue.task_done()
    except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError): pass
    except Exception: pass

async def handler(websocket):
    queue = asyncio.Queue()
    JOGADORES[websocket] = {
        "username": "Anônimo", "sala": None, 
        "x": 200, "y": 150, "spriteId": "cinzaguy", 
        "lado": "direita", "queue": queue
    }
    tarefa_escrita = asyncio.create_task(escritor_cliente(websocket, queue))
    
    try:
        async for message in websocket:
            if websocket not in JOGADORES: break
            dados = json.loads(message)
            sala_atual = JOGADORES[websocket]["sala"]
            
            if dados["tipo"] == "login":
                username_proposto = dados["username"].upper().strip()
                if any(jog["username"] == username_proposto for jog in JOGADORES.values() if jog["sala"] is not None):
                    try: queue.put_nowait(json.dumps({"tipo": "erro_login", "mensagem": f"O NOME '{username_proposto}' JÁ ESTÁ SENDO USADO!"}))
                    except Exception: pass
                else:
                    JOGADORES[websocket]["username"] = username_proposto
                    JOGADORES[websocket]["spriteId"] = dados.get("spriteId", "cinzaguy")
                    await mover_jogador(websocket, "the_hub")
                
            elif dados["tipo"] == "mover":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                JOGADORES[websocket]["lado"] = dados.get("lado", "direita")
                await enviar_para_sala(sala_atual, {"tipo": "movimento", "id": id(websocket), "x": dados["x"], "y": dados["y"], "lado": JOGADORES[websocket]["lado"]})
                
            elif dados["tipo"] == "mudar_sala":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                await mover_jogador(websocket, dados["nova_sala"])

            elif dados["tipo"] == "interagir_pong":
                global PONG_STATE
                voce_sentou = False
                
                if not PONG_STATE["p1_ws"]:
                    PONG_STATE["p1_ws"] = websocket
                    JOGADORES[websocket]["x"] = 185 
                    JOGADORES[websocket]["y"] = 205 
                    JOGADORES[websocket]["lado"] = "direita"
                    voce_sentou = True
                elif not PONG_STATE["p2_ws"] and PONG_STATE["p1_ws"] != websocket:
                    PONG_STATE["p2_ws"] = websocket
                    JOGADORES[websocket]["x"] = 270 
                    JOGADORES[websocket]["y"] = 205 
                    JOGADORES[websocket]["lado"] = "esquerda"
                    voce_sentou = True
                
                if voce_sentou:
                    # Avisa as coordenadas pra todo mundo
                    await enviar_para_sala("sala_jogos", {
                        "tipo": "movimento", "id": id(websocket), 
                        "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"], 
                        "lado": JOGADORES[websocket]["lado"]
                    })
                    
                    # Checa: Se as duas cadeiras estão ocupadas, QUE COMECEM OS JOGOS!
                    if PONG_STATE["p1_ws"] and PONG_STATE["p2_ws"] and not PONG_STATE["ativo"]:
                        PONG_STATE["ativo"] = True 
                        PONG_STATE["p1_score"] = 0
                        PONG_STATE["p2_score"] = 0
                        reset_bola_pong() # Dispara a bola
                    
                    resposta_direta = {
                        "tipo": "atualizacao_pong",
                        "voce_esta_jogando": True,
                        "meu_x": JOGADORES[websocket]["x"],
                        "meu_y": JOGADORES[websocket]["y"],
                        "meu_lado": JOGADORES[websocket]["lado"],
                        "estado": {
                            "p1_y": int(PONG_STATE["p1_y"]), "p2_y": int(PONG_STATE["p2_y"]),
                            "bola_x": int(PONG_STATE["bola_x"]), "bola_y": int(PONG_STATE["bola_y"]),
                            "p1_score": PONG_STATE["p1_score"], "p2_score": PONG_STATE["p2_score"]
                        }
                    }
                    queue.put_nowait(json.dumps(resposta_direta))

            elif dados["tipo"] == "comando_pong":
                if websocket == PONG_STATE["p1_ws"]:
                    if dados["acao"] == "subir": PONG_STATE["p1_y"] = max(0, PONG_STATE["p1_y"] - 5)
                    elif dados["acao"] == "descer": PONG_STATE["p1_y"] = min(115, PONG_STATE["p1_y"] + 5)
                elif websocket == PONG_STATE["p2_ws"]:
                    if dados["acao"] == "subir": PONG_STATE["p2_y"] = max(0, PONG_STATE["p2_y"] - 5)
                    elif dados["acao"] == "descer": PONG_STATE["p2_y"] = min(115, PONG_STATE["p2_y"] + 5)

            elif dados["tipo"] == "sair_pong":
                # Reseta as máquinas usando a função global e esconde a tela preta
                abandonar_pong(websocket)
                queue.put_nowait(json.dumps({
                    "tipo": "atualizacao_pong", 
                    "voce_esta_jogando": False, 
                    "estado": { "p1_y": 60, "p2_y": 60, "bola_x": 100, "bola_y": 75, "p1_score": 0, "p2_score": 0 }
                }))

            elif dados["tipo"] == "chat":
                await enviar_para_sala(sala_atual, {"tipo": "chat", "username": JOGADORES[websocket]["username"], "texto": dados["texto"]})
            elif dados["tipo"] == "digitando":
                await enviar_para_sala(sala_atual, {"tipo": "jogador_digitando", "id": id(websocket), "estado": dados["estado"]})

    except websockets.exceptions.ConnectionClosed: pass
    finally:
        tarefa_escrita.cancel()
        if websocket in JOGADORES:
            sala_atual = JOGADORES[websocket]["sala"]
            # Se o cara fechou a aba (desconectou), abandona o jogo e zera tudo
            abandonar_pong(websocket)
            if sala_atual and websocket in SALAS[sala_atual]:
                SALAS[sala_atual].discard(websocket)
                await enviar_para_sala(sala_atual, {"tipo": "jogador_saiu", "id": id(websocket)})
            JOGADORES.pop(websocket, None)

def pegar_ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(('8.8.8.8', 80)); ip = s.getsockname()[0]
    except Exception: ip = '127.0.0.1'
    finally: s.close()
    return ip

def rodar_servidor_web_background():
    dir_alvo = "public" if os.path.exists("public") else "."
    class HandlerCustomizado(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs): super().__init__(*args, directory=dir_alvo, **kwargs)
    TCPServer.allow_reuse_address = True
    try:
        with TCPServer(("", 8000), HandlerCustomizado) as httpd: httpd.serve_forever()
    except Exception: pass

async def main():
    print("=" * 65)
    print("        SALA 33 - HUB DE EXECUÇÃO UNIFICADO (LAN ACTIVE)        ")
    print("=" * 65)
    ip_rede = pegar_ip_local()
    print(f"» Endereço IP Local Detectado: {ip_rede}")
    
    asyncio.create_task(loop_fisica_pong())
    threading.Thread(target=rodar_servidor_web_background, daemon=True).start()
    
    print("-" * 65)
    print(f"🌍 ACESSO AO SITE (HTTP)  : http://{ip_rede}:8000")
    print(f"⚡ REDE DO MULTIPLAYER (WS): ws://{ip_rede}:8080")
    print("=" * 65)
    async with websockets.serve(handler, "0.0.0.0", 8080):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado.")