# 🕹️ SALA 33

Ambiente multiplayer em tempo real desenvolvido como projeto da disciplina de **Sistemas Distribuídos**. Inspirado em RPGs retrô e mundos virtuais como o Club Penguin, o projeto simula um pequeno mundo com salas interconectadas, chat, personagens e minigames — tudo sincronizado via WebSockets.

O projeto é **open-source** e foi construído para ser fácil de expandir: qualquer pessoa pode criar novas salas, personagens, músicas e mecânicas sem tocar no engine principal.

> 📖 Quer contribuir? Leia o **[MODDING.md](./MODDING.md)**.

---

## 🌐 Funcionalidades

### Mundo e Navegação
- 5 salas interconectadas com transição suave entre elas
- Cada sala tem fundo, trilha sonora e conexões próprias
- Spawn definido por sala de destino

### Multiplayer em Tempo Real
- Movimento sincronizado de todos os jogadores na sala
- Entrada e saída de jogadores notificada para todos
- Somente jogadores da mesma sala trocam eventos entre si

### Personagens
- 7 skins disponíveis (sprites 32×32 pixel art)
- Animação de bobeio ao se mover
- Espelhamento automático de sprite baseado na direção

### Chat
- Mensagens em tempo real com balões de fala sobre os personagens
- Indicador de digitação (`...`) visível para os outros
- Emotes via botões ou atalhos de teclado (`:)`, `:(`, `<3`, etc.)

### Áudio
- Trilha sonora por sala com lazy loading (só baixa quando entra na sala)
- Controle de volume via `F1`

### Minigames
- 🏓 **Pong Multiplayer** — física da bola rodando no servidor a 60fps
- 🔥 **Duelo de Aura** — quem aperta espaço mais rápido; partículas e screen shake escalados por nível

---

## 🗺️ Salas Disponíveis

| Sala | Descrição |
|---|---|
| 🏠 The Hub | Área central, conecta todas as outras |
| 🎮 Sala de Jogos | Mesa de Pong multiplayer |
| 🖼️ Museu | Galeria de arte interativa |
| 🌲 Floresta | Sala ambiente |
| 🛏️ O Quarto | Duelo de Aura via TV |

---

## 🚀 Como Executar

### Pré-requisitos

```bash
pip install -r requirements.txt
```

### Iniciar o servidor

```bash
python server.py
```

Ao iniciar, o terminal exibe:

```
=================================================================
        SALA 33 — HUB DE EXECUÇÃO UNIFICADO (LAN ACTIVE)
=================================================================
» Salas registradas: the_hub, sala_jogos, museu, floresta, o_quarto
» Sala inicial: the_hub
» Carregando mecânicas de servidor:
  ✓ server_mods.sala_jogos  →  ['interagir_pong', 'comando_pong', 'sair_pong']
  ✓ server_mods.o_quarto    →  ['interagir_aura', 'spam_aura', 'sair_aura']
-----------------------------------------------------------------
» Endereço IP Local: 192.168.x.x
🌍 ACESSO AO SITE (HTTP)  : http://192.168.x.x:8000
⚡ REDE DO MULTIPLAYER (WS): ws://192.168.x.x:8080
=================================================================
```

### Acessar

Abra no navegador (qualquer dispositivo na mesma rede):

```
http://SEU_IP_LOCAL:8000
```

| Serviço | Porta |
|---|---|
| HTTP (frontend) | 8000 |
| WebSocket (multiplayer) | 8080 |

---

## 🎮 Controles

| Ação | Tecla |
|---|---|
| Mover | WASD ou Setas |
| Interagir | E |
| Chat | Enter |
| Sair de interação / minigame | Q |
| Duelo de Aura (spam) | Espaço |
| Volume | F1 |
| Debug (hitboxes e grid) | F2 |

---

## 🏗️ Arquitetura

### Visão Geral

O servidor é **autoritativo**: todo estado global (posições, pontuações, minigames) vive nele. O cliente é responsável apenas por renderizar e enviar inputs.

```
Cliente (browser)                    Servidor (Python)
─────────────────                    ─────────────────
index.html + game.js                 server.py
      │                                    │
      │   WebSocket JSON messages          │
      │ ◄─────────────────────────────►   │
      │                                    │
  Canvas 2D                         asyncio + websockets
  Plugin system                     ThreadingTCPServer (HTTP)
  Lazy audio                        server_mods/*.py (mecânicas)
```

### Protocolo de Mensagens

Todas as mensagens são JSON com um campo `"tipo"`. Exemplos:

| `tipo` | Direção | Descrição |
|---|---|---|
| `login` | cliente → servidor | Autentica e entra na sala inicial |
| `mover` | cliente → servidor | Atualiza posição |
| `mudar_sala` | cliente → servidor | Troca de sala via porta |
| `chat` | bidirecional | Mensagem de texto |
| `novo_jogador` | servidor → cliente | Notifica entrada de jogador |
| `movimento` | servidor → cliente | Broadcast de posição |
| `jogador_saiu` | servidor → cliente | Notifica saída |
| `atualizacao_pong` | servidor → cliente | Estado do Pong a 60fps |
| `atualizacao_aura` | servidor → cliente | Estado do Duelo de Aura |

### Estrutura de Arquivos

```
Sala33/
├── server.py                    ← engine do servidor
├── server_mods/                 ← mecânicas server-side por sala
│   ├── sala_jogos.py            (Pong)
│   └── o_quarto.py              (Duelo de Aura)
└── public/
    ├── index.html
    ├── game.js                  ← engine do cliente
    ├── assets/
    │   ├── maps/                ← imagens de fundo
    │   ├── characters/          ← sprites
    │   ├── music/               ← trilhas
    │   └── artworks/            ← obras do museu
    └── mods/
        ├── manifest.json        ← lista o que carregar
        ├── personagens.json     ← roster de personagens
        ├── salas/               ← um JSON por sala
        └── logicas/             ← plugins JS client-side por sala
```

### Sistema de Mods

O jogo carrega toda a configuração do mundo de `public/mods/` dinamicamente. O servidor descobre mecânicas novas em `server_mods/` automaticamente ao iniciar.

**Adicionar uma sala nova** não exige tocar no engine — só criar um JSON, colocar os assets nas pastas certas e registrar no `manifest.json`.

---

## 🧩 Contribuindo

O projeto foi pensado para que qualquer pessoa possa criar conteúdo novo sem precisar entender o engine. O fluxo mínimo pra uma sala nova:

1. Coloque a imagem em `public/assets/maps/`
2. Crie `public/mods/salas/minha_sala.json`
3. Adicione o ID em `public/mods/manifest.json`

Para mecânicas interativas (minigames, puzzles, NPCs), veja o **[MODDING.md](./MODDING.md)** — tem a API completa dos plugins com exemplos.

---

## 📚 Conceitos de Sistemas Distribuídos Aplicados

| Conceito | Implementação |
|---|---|
| Comunicação persistente | WebSockets (conexão contínua, sem polling) |
| Protocolo de mensagens | JSON tipado com campo `tipo` |
| Estado autoritativo | Servidor é a única fonte da verdade |
| Broadcast seletivo | Eventos propagados apenas para jogadores da mesma sala |
| Concorrência | `asyncio` com fila de mensagens por conexão (`asyncio.Queue`) |
| Separação de responsabilidades | HTTP (estático) e WS (tempo real) em portas diferentes |
| Lazy loading | Áudio só carregado ao entrar na sala |
| Modularidade | Mecânicas isoladas em módulos Python e plugins JS |

---

## 🛠️ Stack

**Backend:** Python 3 · asyncio · websockets · http.server · ThreadingTCPServer

**Frontend:** HTML5 · CSS3 · JavaScript Vanilla · Canvas 2D API
