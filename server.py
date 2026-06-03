import asyncio
import json
import websockets
import os
import socket
import subprocess
import platform
import threading
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer

# ==========================================
# CONFIGURAÇÕES DE ESTADO MULTIPLAYER
# ==========================================
JOGADORES = {}
SALAS = {
    "the_hub": set(), "museu": set(), "floresta": set(), 
    "o_quarto": set(), "sala_jogos": set()
}

# TRANSMISSOR ULTRA-RÁPIDO: Coloca os pacotes na fila instantaneamente sem perdas
async def enviar_para_sala(sala_nome, payload):
    if not sala_nome or sala_nome not in SALAS or not SALAS[sala_nome]: 
        return
    
    mensagem = json.dumps(payload)
    
    # Varre todos os sockets da sala e injeta a mensagem na fila local de RAM
    for ws in list(SALAS[sala_nome]):
        if ws in JOGADORES:
            # Com a fila ilimitada, put_nowait nunca falha e nunca descarta eventos críticos
            JOGADORES[ws]["queue"].put_nowait(mensagem)

async def mover_jogador(websocket, nova_sala):
    if websocket not in JOGADORES: return
    sala_antiga = JOGADORES[websocket]["sala"]
    
    # 1. Remove da sala antiga e avisa os jogadores de lá
    if sala_antiga and websocket in SALAS[sala_antiga]:
        SALAS[sala_antiga].remove(websocket)
        await enviar_para_sala(sala_antiga, {"tipo": "jogador_saiu", "id": id(websocket)})
    
    # 2. Reúne os veteranos da nova sala para enviar ao jogador que está a entrar
    usuarios_existentes = []
    for outro_ws in list(SALAS[nova_sala]):
        if outro_ws in JOGADORES:
            usuarios_existentes.append({
                "id": id(outro_ws),
                "username": JOGADORES[outro_ws]["username"],
                "x": JOGADORES[outro_ws]["x"],
                "y": JOGADORES[outro_ws]["y"],
                "spriteId": JOGADORES[outro_ws]["spriteId"],
                "lado": JOGADORES[outro_ws].get("lado", "direita")
            })
    
    # Envia a lista completa de uma só vez para o utilizador
    if usuarios_existentes and websocket in JOGADORES:
        try:
            JOGADORES[websocket]["queue"].put_nowait(json.dumps({
                "tipo": "lista_jogadores",
                "jogadores": usuarios_existentes
            }))
        except Exception:
            pass
    
    # 3. Introduz oficialmente o jogador na nova sala e avisa toda a gente de lá
    if websocket in JOGADORES:
        JOGADORES[websocket]["sala"] = nova_sala
        SALAS[nova_sala].add(websocket)
        
        await enviar_para_sala(nova_sala, {
            "tipo": "novo_jogador", "id": id(websocket),
            "username": JOGADORES[websocket]["username"],
            "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
            "spriteId": JOGADORES[websocket]["spriteId"],
            "lado": JOGADORES[websocket].get("lado", "direita")
        })

# MOTOR DE ESCRITA DE REDE: Envia os dados para a placa de rede de forma assíncrona isolada
async def escritor_cliente(websocket, queue):
    try:
        while True:
            mensagem = await queue.get()
            await websocket.send(mensagem)
            queue.task_done()
    except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
        pass
    except Exception:
        pass

async def handler(websocket):
    # CORREÇÃO: Cria uma fila assíncrona dinâmica e ilimitada para garantir integridade total
    queue = asyncio.Queue()
    JOGADORES[websocket] = {
        "username": "Anônimo", "sala": None, 
        "x": 200, "y": 150, "spriteId": "cinzaguy", 
        "lado": "direita", "queue": queue
    }
    
    # Dispara o trabalhador de background para este cliente
    tarefa_escrita = asyncio.create_task(escritor_cliente(websocket, queue))
    
    try:
        async_iterable = websocket.__aimg__ if hasattr(websocket, '__aimg__') else websocket
        async for message in async_iterable:
            if websocket not in JOGADORES:
                break
                
            dados = json.loads(message)
            sala_atual = JOGADORES[websocket]["sala"]
            
            if dados["tipo"] == "login":
                username_proposto = dados["username"].upper().strip()
                nome_ja_existe = any(
                    jog["username"] == username_proposto 
                    for jog in JOGADORES.values() 
                    if jog["sala"] is not None
                )
                
                if nome_ja_existe:
                    try:
                        queue.put_nowait(json.dumps({
                            "tipo": "erro_login",
                            "mensagem": f"O NOME '{username_proposto}' JÁ ESTÁ SENDO USADO NA REDE!"
                        }))
                    except Exception:
                        pass
                else:
                    JOGADORES[websocket]["username"] = username_proposto
                    JOGADORES[websocket]["spriteId"] = dados.get("spriteId", "cinzaguy")
                    JOGADORES[websocket]["lado"] = dados.get("lado", "direita")
                    await mover_jogador(websocket, "the_hub")
                
            elif dados["tipo"] == "mover":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                JOGADORES[websocket]["lado"] = dados.get("lado", "direita")
                
                await enviar_para_sala(sala_atual, {
                    "tipo": "movimento", "id": id(websocket),
                    "x": dados["x"], "y": dados["y"],
                    "lado": JOGADORES[websocket]["lado"] 
                })
                
            elif dados["tipo"] == "mudar_sala":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                JOGADORES[websocket]["lado"] = dados.get("lado", "direita")
                await mover_jogador(websocket, dados["nova_sala"])
                
            elif dados["tipo"] == "chat":
                await enviar_para_sala(sala_atual, {
                    "tipo": "chat", "username": JOGADORES[websocket]["username"], "texto": dados["texto"]
                })
                
            elif dados["tipo"] == "digitando":
                await enviar_para_sala(sala_atual, {
                    "tipo": "jogador_digitando", "id": id(websocket), "estado": dados["estado"]
                })

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Ponto central e seguro de faxina: Garante remoção cirúrgica sem deadlocks
        tarefa_escrita.cancel()
        if websocket in JOGADORES:
            sala_atual = JOGADORES[websocket]["sala"]
            if sala_atual and websocket in SALAS[sala_atual]:
                SALAS[sala_atual].discard(websocket)
                await enviar_para_sala(sala_atual, {"tipo": "jogador_saiu", "id": id(websocket)})
            JOGADORES.pop(websocket, None)

# ==========================================
# AUTOMATIZAÇÃO DE REDE LAN E FIREWALL
# ==========================================
def pegar_ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def abrir_porta_firewall(porta):
    sistema = platform.system().lower()
    try:
        if sistema == "windows":
            nome_regra = f"Sala33_Porta_{porta}"
            subprocess.run(f'netsh advfirewall firewall delete rule name="{nome_regra}"', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            comando = f'netsh advfirewall firewall add rule name="{nome_regra}" dir=in action=allow protocol=TCP localport={porta}'
            subprocess.run(comando, shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif sistema == "linux":
            subprocess.run(f'sudo ufw allow {porta}/tcp', shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        print(f"⚠️ [Aviso] Sem permissão para auto-configurar o Firewall na porta {porta}.")

def rodar_servidor_web_background():
    dir_alvo = "public" if os.path.exists("public") else "."
    class HandlerCustomizado(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=dir_alvo, **kwargs)
    TCPServer.allow_reuse_address = True
    try:
        with TCPServer(("", 8000), HandlerCustomizado) as httpd:
            httpd.serve_forever()
    except Exception as e:
        print(f"❌ Erro no Servidor Web: {e}")

async def main():
    print("=" * 65)
    print("        SALA 33 - HUB DE EXECUÇÃO UNIFICADO (LAN ACTIVE)        ")
    print("=" * 65)
    ip_rede = pegar_ip_local()
    print(f"» Endereço IP Local Detectado: {ip_rede}")
    abrir_porta_firewall(8080)
    abrir_porta_firewall(8000)
    web_thread = threading.Thread(target=rodar_servidor_web_background, daemon=True)
    web_thread.start()
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