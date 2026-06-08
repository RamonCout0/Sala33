# Pacote de mecânicas do servidor.
# Cada arquivo .py aqui dentro pode definir uma mecânica nova de sala.
#
# Interface esperada para cada módulo:
#   HANDLES = ["tipo_de_mensagem1", "tipo_de_mensagem2", ...]
#       Lista dos tipos de mensagem que o módulo processa.
#
#   async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
#       Chamado quando uma mensagem com tipo em HANDLES chega.
#
#   async def tick(JOGADORES, SALAS, enviar_para_sala):
#       (opcional) Chamado ~60 vezes por segundo. Use para física de minigames.
#
#   def on_leave(websocket, JOGADORES):
#       (opcional) Chamado quando o jogador sai da sala ou desconecta.
#       Use para limpar estado vinculado ao jogador.
