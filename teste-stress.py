import asyncio
import json
import random
import websockets

# ==========================================
# CONFIGURAÇÕES DO TESTE DE ESTRESSE
# ==========================================
SERVER_URL = "ws://localhost:8080" 
NUM_BOTS = 10                      # Quantidade estável de bots simultâneos
TICK_MOVIMENTO = 0.60              # CORRIGIDO: Movimento a cada 600ms (reduz Drasticamente o spam de I/O)
CHANCE_CHAT = 0.04                 # Chance (4%) de um bot mandar mensagem no frame
CHANCE_MUDAR_SALA = 0.02           # Chance (2%) de o bot pegar uma porta e mudar de sala

# Bancos de dados
SKINS = ["cinzaguy", "bailarina", "cat", "dog", "nututu"]
NOMES_BASE = ["ALICE", "KIRO", "SHADOW", "RETRO", "GHOST", "PENGUIN", "ROBOT", "NOIR", "SPIKE", "PIXEL"]
SALAS_DISPONIVEIS = ["the_hub", "sala_jogos", "museu", "floresta", "o_quarto"]

COMENTARIOS = [
    "O futuro é pik!", "Que pinguim gigante é esse kkkk", "Mano, o pulinho tá muito clean!",
    "Alguém viu a bailarina?", "O cinzaguy tá girando kkkk", "Vou dar uma olhada na outra sala",
    "Estilo Minit total essa arte", "F2 neles kkk", "(•‿•)", "Fui!", "Partiu explorar",
    "(╥﹏╥)", "(❤️)", "(o_O)", "(≧◡≦)", "(━╤┳━)"
]

async def rodar_bot(id_bot):
    """Instância assíncrona isolada que caminha e viaja entre as salas."""
    username = f"{random.choice(NOMES_BASE)}_{random.randint(100, 999)}"
    sprite_id = random.choice(SKINS)
    
    # Estado inicial do Bot
    sala_atual = "the_hub"
    x = random.randint(50, 350)
    y = random.randint(80, 220)
    lado = "direita"
    
    print(f"🤖 [Bot {id_bot}] Criado: {username} ({sprite_id})")
    
    try:
        async with websockets.connect(SERVER_URL) as ws:
            # 1. Login inicial (Sempre nasce no Hub)
            await ws.send(json.dumps({
                "tipo": "login",
                "username": username,
                "spriteId": sprite_id,
                "lado": lado
            }))
            
            while True:
                # ==========================================
                # CONDICIONAL: Sorteia se vai mudar de sala
                # ==========================================
                if random.random() < CHANCE_MUDAR_SALA:
                    # Escolhe uma sala diferente da que ele está agora
                    outras_salas = [s for s in SALAS_DISPONIVEIS if s != sala_atual]
                    sala_atual = random.choice(outras_salas)
                    
                    # Sorteia coordenadas de spawn para a nova sala
                    x = random.randint(60, 340)
                    y = random.randint(60, 240)
                    
                    # Dispara a requisição de teleporte para o server.py
                    await ws.send(json.dumps({
                        "tipo": "mudar_sala",
                        "nova_sala": sala_atual,
                        "x": x,
                        "y": y,
                        "lado": lado
                    }))
                    # Pula o resto do tick para simular o tempo de loading da porta
                    await asyncio.sleep(TICK_MOVIMENTO)
                    continue

                # ==========================================
                # COMPORTAMENTO: Movimentação padrão na sala
                # ==========================================
                dx = random.choice([-8, 0, 8])
                dy = random.choice([-8, 0, 8])
                
                if dx < 0:
                    lado = "esquerda"
                elif dx > 0:
                    lado = "direita"
                    
                x = max(15, min(400 - 32, x + dx))
                y = max(40, min(300 - 32, y + dy))
                
                # Envia o pacote de movimentação
                await ws.send(json.dumps({
                    "tipo": "mover",
                    "x": x,
                    "y": y,
                    "lado": lado
                }))
                
                # ==========================================
                # COMPORTAMENTO: Chat Simulado
                # ==========================================
                if random.random() < CHANCE_CHAT:
                    frase = random.choice(COMENTARIOS)
                    
                    await ws.send(json.dumps({"tipo": "digitando", "estado": True}))
                    await asyncio.sleep(0.3)
                    await ws.send(json.dumps({"tipo": "digitando", "estado": False}))
                    
                    await ws.send(json.dumps({
                        "tipo": "chat",
                        "texto": frase
                    }))
                
                # Descansa a Task assíncrona
                await asyncio.sleep(TICK_MOVIMENTO)
                
    except Exception as e:
        pass # Silencia quedas individuais para manter o log limpo

async def main():
    print("=" * 65)
    print("     SALA 33 - SIMULADOR DE ROAMING MULTIPLAYER (STRESS TEST)    ")
    print("=" * 65)
    print(f"Alvo do teste: {SERVER_URL}")
    print(f"Conectando {NUM_BOTS} bots andarilhos...")
    print("-" * 65)
    
    bots_tasks = [rodar_bot(i) for i in range(1, NUM_BOTS + 1)]
    await asyncio.gather(*bots_tasks)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n» Carga finalizada. Bots desconectados.")