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

async def enviar_para_sala(sala_nome, payload):
    if not sala_nome or sala_nome not in SALAS or not SALAS[sala_nome]: 
        return
    mensagem = json.dumps(payload)
    for ws in list(SALAS[sala_nome]):
        try:
            await ws.send(mensagem)
        except (websockets.exceptions.ConnectionClosed, Exception):
            SALAS[sala_nome].discard(ws)

async def mover_jogador(websocket, nova_sala):
    sala_antiga = JOGADORES[websocket]["sala"]
    
    if sala_antiga and websocket in SALAS[sala_antiga]:
        SALAS[sala_antiga].remove(websocket)
        await enviar_para_sala(sala_antiga, {"tipo": "jogador_saiu", "id": id(websocket)})
    
    usuarios_existentes = []
    for outro_ws in list(SALAS[nova_sala]):
        if outro_ws in JOGADORES:
            usuarios_existentes.append({
                "id": id(outro_ws),
                "username": JOGADORES[outro_ws]["username"],
                "x": JOGADORES[outro_ws]["x"],
                "y": JOGADORES[outro_ws]["y"],
                "spriteId": JOGADORES[outro_ws]["spriteId"]
            })
    
    if usuarios_existentes:
        try:
            await websocket.send(json.dumps({
                "tipo": "lista_jogadores",
                "jogadores": usuarios_existentes
            }))
        except Exception:
            return
    
    JOGADORES[websocket]["sala"] = nova_sala
    SALAS[nova_sala].add(websocket)
    
    await enviar_para_sala(nova_sala, {
        "tipo": "novo_jogador", "id": id(websocket),
        "username": JOGADORES[websocket]["username"],
        "x": JOGADORES[websocket]["x"], "y": JOGADORES[websocket]["y"],
        "spriteId": JOGADORES[websocket]["spriteId"]
    })

async def handler(websocket):
    JOGADORES[websocket] = {"username": "Anônimo", "sala": None, "x": 200, "y": 150, "spriteId": "cinzaguy"}
    try:
        async for message in websocket:
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
                    await websocket.send(json.dumps({
                        "tipo": "erro_login",
                        "mensagem": f"O NOME '{username_proposto}' JÁ ESTÁ SENDO USADO NA REDE!"
                    }))
                else:
                    JOGADORES[websocket]["username"] = username_proposto
                    JOGADORES[websocket]["spriteId"] = dados.get("spriteId", "cinzaguy")
                    await mover_jogador(websocket, "the_hub")
                
            elif dados["tipo"] == "mover":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
                await enviar_para_sala(sala_atual, {
                    "tipo": "movimento", "id": id(websocket),
                    "x": dados["x"], "y": dados["y"]
                })
                
            elif dados["tipo"] == "mudar_sala":
                JOGADORES[websocket]["x"] = dados["x"]
                JOGADORES[websocket]["y"] = dados["y"]
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
        print(f"⚠️ [Aviso] Sem permissão para auto-configurar o Firewall na porta {porta}. Se necessário, execute como Admin/Sudo.")

# ==========================================
# DAEMON DO SERVIDOR WEB (PORTA 8000)
# ==========================================
def rodar_servidor_web_background():
    # Descobre defensivamente se a pasta 'public' está aqui ou se já estamos dentro dela
    dir_alvo = "public" if os.path.exists("public") else "."
    
    class HandlerCustomizado(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=dir_alvo, **kwargs)
            
    TCPServer.allow_reuse_address = True
    try:
        with TCPServer(("", 8000), HandlerCustomizado) as httpd:
            httpd.serve_forever()
    except Exception as e:
        print(f"❌ Erro crítico no Servidor Web: {e}")

# ==========================================
# DISPARADOR DO SISTEMA UNIFICADO
# ==========================================
async def main():
    print("=" * 65)
    print("        SALA 33 - HUB DE EXECUÇÃO UNIFICADO (LAN ACTIVE)        ")
    print("=" * 65)
    
    ip_rede = pegar_ip_local()
    print(f"» Endereço IP Local Detectado: {ip_rede}")
    
    # Executa a limpeza do Firewall em background
    abrir_porta_firewall(8080)
    abrir_porta_firewall(8000)
    
    # Inicia o servidor web (arquivos HTML/JS) em uma Thread paralela de segurança
    web_thread = threading.Thread(target=rodar_servidor_web_background, daemon=True)
    web_thread.start()
    
    print("-" * 65)
    print(f"🌍 ACESSO AO SITE (HTTP)  : http://{ip_rede}:8000")
    print(f"⚡ REDE DO MULTIPLAYER (WS): ws://{ip_rede}:8080")
    print("=" * 65)
    print("🎮 Servidor Ativo. Registrando movimentações em tempo real:\n")

    # Inicia o servidor de WebSockets principal do Asyncio
    async with websockets.serve(handler, "0.0.0.0", 8080):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Servidor desligado pelo desenvolvedor. Até mais!")