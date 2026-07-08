# 🧩 GUIA DE MODDING — SALA 33

Bem-vindo! Este documento explica como adicionar conteúdo novo ao SALA 33 sem mexer no engine principal.

A ideia é simples: tudo o que define o mundo do jogo vive em duas pastas — `public/mods/` (cliente) e `server_mods/` (servidor). Quem quiser fazer "sua sala" só precisa criar uns arquivos novos e listá-los no manifest.

---

## 📁 Estrutura do projeto

> **⚠️ Mudança importante:** o cliente foi refatorado. **Não existe mais `public/game.js`** — o engine do cliente agora é **modular**, escrito em ES Modules em `src/` e **buildado com Vite**. Mas isso **não muda nada pra quem faz mod**: seus mods continuam vivendo 100% em `public/mods/` e `server_mods/`, exatamente como antes. Você nunca precisa tocar em `src/`.

```
Sala33/
├── server.py                       ← engine do servidor (não mexer)
├── server_mods/                    ← mecânicas server-side por sala
│   ├── sala_jogos.py               (exemplo: Pong)
│   ├── o_quarto.py                 (exemplo: Duelo de Aura)
│   └── xadrez.py                   (exemplo: Xadrez com regras completas)
├── index.html                      ← entrada do Vite (na raiz)
├── vite.config.js                  ← config do build
├── package.json                    ← scripts: npm run dev / build
├── src/                            ← engine do CLIENTE (não mexer)
│   ├── main.js                     ← loop, estado, input, render
│   ├── net/  audio/  render/       ← módulos do engine
│   └── ui/   world/  core/
├── dist/                           ← saída do `npm run build` (gerado, gitignored)
└── public/                         ← servido VERBATIM (copiado pro dist/ no build)
    ├── assets/
    │   ├── maps/                   ← imagens/vídeos de fundo das salas
    │   ├── characters/             ← sprites dos personagens
    │   ├── music/                  ← trilhas
    │   └── artworks/               ← obras do museu, etc
    └── mods/                       ← ✦ AQUI é onde você trabalha ✦
        ├── manifest.json           ← lista o que carregar
        ├── personagens.json        ← roster de personagens
        ├── salas/                  ← um JSON por sala
        │   └── *.json
        └── logicas/                ← plugins JS client-side por sala
            └── *.js
```

> **Por que `public/mods/logicas/*.js` não some no build:** esses plugins ficam no `publicDir` do Vite, então são copiados **sem serem bundlados** e carregados em **runtime** (via `<script>`) — é isso que mantém o sistema de mods aberto pra qualquer pessoa.

---

## 🎨 Adicionar um personagem novo

1. Coloque o sprite (PNG 32×32) em `public/assets/characters/meu_sprite.png`.
2. Abra `public/mods/personagens.json` e adicione:

   ```json
   { "id": "meu_sprite", "nome": "MEU PERSONAGEM", "sprite": "assets/characters/meu_sprite.png" }
   ```

Pronto. Ele aparece no dropdown da tela inicial.

> **⚠️ Regra obrigatória de estilo:** sprites de personagem devem usar **exclusivamente tons de cinza** (preto, branco e escala de cinza). Sem cores. Isso garante a identidade visual noir do projeto e a consistência entre personagens de autores diferentes.

---

## 🚪 Adicionar uma sala nova

Pra criar uma sala chamada `minha_sala`:

### 1. Coloque os assets

- Fundo: `public/assets/maps/minha_sala.png` (PNG, JPG, GIF ou MP4/WEBM para fundo animado)
- Música: `public/assets/music/minha_sala.mp3` (opcional)


> **Sobre GIF e MP4 como fundo:** GIF é exibido como imagem estática no canvas (só o primeiro frame). Para fundo animado de verdade, use MP4 ou WEBM e implemente via plugin em `mods/logicas/` usando um elemento `<video>` como fonte do `drawImage` a cada frame.

> ### 🪧 ORDEM DE RENDERIZAÇÃO — leia antes de desenhar qualquer coisa
>
> O canvas não tem `z-index` automático como o CSS: **o que é desenhado por último fica por cima.** A cada frame, o engine pinta nesta ordem:
>
> 1. **Fundo estático** da sala (a imagem/cor do JSON)
> 2. **`renderFundo(ctx)`** do seu plugin  ← desenhe **fundos animados** (vídeo, neblina de fundo) aqui
> 3. **Outros jogadores** e o **seu personagem**
> 4. **`render(ctx, ...)`** do seu plugin  ← desenhe **overlays por cima** (HUD, chuva, minigame) aqui
>
> ⚠️ **Erro clássico:** desenhar um fundo de vídeo dentro de `render()`. Como `render()` roda **depois** dos jogadores, o vídeo "carimba" por cima de todo mundo e some os personagens. Para fundo, use **`renderFundo`**.

**Exemplo de plugin com fundo em vídeo animado:**

`public/mods/logicas/minha_sala.js`:
```js
SALA33_REGISTRAR("minha_sala", {
    _video: null,
    _pronto: false,

    onEnter(salaConfig) {
        // Cria o elemento de vídeo em background (nunca aparece no DOM)
        this._video = document.createElement("video");
        this._video.src = salaConfig.imagemPath; // aponta pro .mp4 ou .webm
        this._video.loop = true;
        this._video.muted = true;  // obrigatório pra autoplay funcionar
        this._video.playsInline = true;
        this._video.play().catch(() => {});
        this._pronto = false;
        this._video.addEventListener("canplay", () => { this._pronto = true; });
    },

    onSair() {
        if (this._video) {
            this._video.pause();
            this._video.src = "";
            this._video = null;
        }
        this._pronto = false;
    },

    onMensagem() { return false; },
    onTeclaDown() { return false; },
    onFisica() { return { bloqueiaMovimento: false, tremor: 0 }; },

    // ✅ Fundo animado vai em renderFundo (roda ANTES dos jogadores → fica atrás).
    renderFundo(ctx) {
        if (this._pronto && this._video) {
            ctx.drawImage(this._video, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    },

    // render() continua existindo pra overlays POR CIMA dos jogadores
    // (neblina, chuva, HUD). Deixe vazio se não precisar.
    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {},
});
```

No JSON da sala, aponte `"imagem"` pro arquivo de vídeo normalmente:
```json
{
  "id": "minha_sala",
  "imagem": "assets/maps/minha_sala.mp4",
  ...
}
```

O engine vai tentar carregar o vídeo como `<img>` (vai falhar silenciosamente) e o plugin desenha o frame atual do vídeo no `renderFundo()`, **atrás** dos jogadores. O resultado é animação fluida em loop, com os personagens visíveis por cima, sem afetar a performance dos outros jogadores.

### 2. Crie o JSON da sala

`public/mods/salas/minha_sala.json`:

```json
{
  "id": "minha_sala",
  "nome": "NOME EXIBIDO",
  "corFundo": "#1a1a1a",
  "imagem": "assets/maps/minha_sala.png",
  "musica": "assets/music/minha_sala.mp3",
  "portas": [
    {
      "destino": "the_hub",
      "x": 0, "y": 130, "w": 20, "h": 40,
      "spawnX": 50, "spawnY": 150
    }
  ]
}
```

Cada porta tem o retângulo de colisão (`x, y, w, h`) e a posição onde o jogador aparece (`spawnX, spawnY`) na sala de **destino**.
> **⚠️ OBS!:** quando Forem fazer os TPs, sempre soma ou diminua 16 por exemplo se você quiser colocar na posição x: 200 adicione 16 e fica 216, isso é só motivos na programção do sprite, é essência da gambiarra que da certo.

### 3. Registre no manifest

`public/mods/manifest.json` — adicione `"minha_sala"` ao array `salas`:

```json
{
  "salaInicial": "the_hub",
  "salas": ["the_hub", "sala_jogos", "museu", "floresta", "o_quarto", "minha_sala"],
  "logicas": ["sala_jogos", "museu", "o_quarto"]
}
```

### 4. Faça outra sala apontar para a sua

Se quer que dê pra chegar na sua sala, adicione uma porta na sala vizinha. Exemplo em `the_hub.json`:

```json
{ "destino": "minha_sala", "x": 350, "y": 200, "w": 30, "h": 40, "spawnX": 200, "spawnY": 250 }
```

Reinicie o servidor (`python server.py`) e tá no ar.

---

## ⚙️ Adicionar mecânica nova (client-side)

Se sua sala precisa de interação especial (NPC, objeto colecionável, puzzle, etc.) que não envolve outros jogadores, basta um plugin JS.

### 1. Crie `public/mods/logicas/minha_sala.js`

```js
SALA33_REGISTRAR("minha_sala", {
    _meuEstado: null,

    onEnter(salaConfig) {
        // Chamado quando o jogador entra na sala.
        // salaConfig.extras é o objeto "extras" do JSON da sala.
    },

    onSair() {
        // Chamado ao sair da sala. Limpe estado aqui.
    },

    onMensagem(dados, ws, meuBicho, tocarMusica, salaAtual) {
        // Mensagens do servidor que o engine não conhece chegam aqui.
        // Retorne true se consumiu a mensagem.
        return false;
    },

    onTeclaDown(code, ws, meuBicho) {
        // Tecla pressionada. Retorne true se consumiu.
        if (code === "KeyE") { /* interage */ return true; }
        return false;
    },

    onFisica(meuBicho, ws, teclas) {
        // Chamado a cada frame antes do movimento.
        // Retorne bloqueiaMovimento=true se quiser travar o jogador
        // (ex.: durante diálogo ou minigame).
        // tremor é a intensidade de screen shake (0 = nenhum).
        return { bloqueiaMovimento: false, tremor: 0 };
    },

    renderFundo(ctx) {
        // (Opcional) Desenhado logo APÓS o fundo estático e ANTES dos
        // jogadores → fica ATRÁS deles. Use pra fundo animado (vídeo),
        // neblina de fundo, etc. Ver a seção "Ordem de renderização".
    },

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        // Desenhe overlays customizados aqui.
        // É a ÚLTIMA coisa do frame → fica POR CIMA do fundo e dos jogadores.
        // Bom pra HUD, chuva, neblina por cima, telas de minigame.
    },
});
```

> **Resumo dos dois hooks de desenho:** use **`renderFundo(ctx)`** pra tudo que fica **atrás** dos jogadores (fundo animado) e **`render(ctx, ...)`** pra tudo que fica **na frente** (overlays). Os dois são opcionais.

### 2. Registre a lógica no manifest

Adicione `"minha_sala"` ao array `logicas` em `manifest.json`.

### 3. Acesse dados configuráveis via `extras`

Coisas que o modder vai querer ajustar (posições de objetos, valores, etc.) ficam no `extras` do JSON da sala:

```json
"extras": {
  "npc": { "x": 100, "y": 150 },
  "frase": "Você não devia estar aqui."
}
```

E no plugin:

```js
onEnter(salaConfig) {
    this._npc = salaConfig.extras.npc;
    this._frase = salaConfig.extras.frase;
}
```

Assim outras pessoas conseguem alterar o comportamento da sala só editando o JSON.

---

## 🌐 Adicionar mecânica nova (server-side)

Se a mecânica precisa sincronizar múltiplos jogadores (minigame competitivo, evento global, etc.), você precisa de um módulo Python.

### 1. Crie `server_mods/minha_sala.py`

```python
import json

# Tipos de mensagem que esse mod processa
HANDLES = ["meu_evento", "outro_evento"]
SALA = "minha_sala"

# Estado global do mod
STATE = {
    "valor_global": 0,
    # ...
}

def on_leave(websocket, JOGADORES):
    """Limpa qualquer referência ao websocket que saiu."""
    pass

async def tick(JOGADORES, SALAS, enviar_para_sala):
    """Chamado ~60 vezes por segundo. Opcional."""
    pass

async def handle(tipo, websocket, dados, JOGADORES, SALAS, enviar_para_sala):
    """Roteia mensagens em HANDLES."""
    if tipo == "meu_evento":
        # Faz algo
        await enviar_para_sala(SALA, {
            "tipo": "resposta_meu_evento",
            "valor": STATE["valor_global"],
        })
```

### 2. Trate a resposta no plugin do cliente

No `onMensagem` do plugin client-side:

```js
onMensagem(dados, ws, meuBicho) {
    if (dados.tipo === "resposta_meu_evento") {
        // ...
        return true;
    }
    return false;
}
```

E pra enviar mensagem ao servidor:

```js
ws.send(JSON.stringify({ tipo: "meu_evento", parametro: "valor" }));
```

Não precisa registrar o `server_mods/minha_sala.py` em lugar nenhum — o servidor descobre sozinho ao iniciar.

---

## 🎵 Músicas extras (para minigames, eventos)

Se uma sala tem múltiplas músicas (a normal + uma de minigame), declare assim no JSON da sala:

```json
{
  "musica": "assets/music/minha_sala.mp3",
  "musicasExtras": {
    "boss": "assets/music/boss_fight.mp3",
    "calmo": "assets/music/calmo.mp3"
  }
}
```

E no plugin, chame:

```js
tocarMusica("boss");
// ...quando terminar:
tocarMusica(salaAtual); // volta pra normal
```

---

## 🛠️ Rodar e testar localmente

Como o cliente agora é buildado com Vite, tem dois jeitos:

**A) Dev (recomendado pra desenvolver) — hot reload do engine:**
```bash
npm install        # só na primeira vez
npm run dev        # Vite na :5173  (terminal 1)
python server.py   # WebSocket na :8080  (terminal 2)
```
Abra **http://localhost:5173**. O client conecta o WebSocket direto na `:8080`.

**B) Produção local (simula o deploy) — serve o build:**
```bash
npm run build      # gera o dist/
python server.py   # serve dist/ na :8000 + WS na :8080
```
Abra **http://localhost:8000**.

> **Sobre mexer em mod e ver a mudança:** os JSONs (`mods/salas/*.json`, `manifest.json`) e os plugins (`mods/logicas/*.js`) ficam no `public/` e são servidos com `Cache-Control: no-cache` — é só recarregar (F5) o browser. No modo **A (dev)** isso vale direto; no modo **B** você precisa rodar `npm run build` de novo (ou editar o arquivo correspondente dentro de `dist/`). Mudanças em `server.py` ou `server_mods/*.py` **sempre** exigem reiniciar o servidor.

---

## 📌 Convenções

- IDs (de salas, personagens, lógicas) usam `snake_case` em minúsculas.
- O canvas é 400×300px. O sprite do jogador é 32×32.
- O `id(websocket)` é único por conexão e usado como identificador do jogador na rede.
- Bloqueio de movimento (no `onFisica`) é o jeito correto de "trancar" o jogador durante uma interação.

---

## 🤝 Como contribuir via Git

### 1. Fork e clone

Faça um fork do repositório pelo GitHub e clone o seu fork localmente:

```bash
git clone https://github.com/SEU_USUARIO/Sala33.git
cd Sala33
```

### 2. Crie uma branch para o seu conteúdo

Nunca trabalhe direto na `main`. Crie uma branch com um nome descritivo:

```bash
git checkout -b sala/nome-da-sua-sala
# ou
git checkout -b personagem/nome-do-personagem
# ou
git checkout -b fix/descricao-do-bug
```

### 3. Faça suas alterações e commit

```bash
git add .
git commit -m "sala: adiciona biblioteca_arcana com puzzle de livros"
```

Use prefixos no commit pra deixar claro o tipo de contribuição:

| Prefixo | Quando usar |
|---|---|
| `sala:` | Nova sala ou alteração em sala existente |
| `personagem:` | Novo sprite de personagem |
| `fix:` | Correção de bug |
| `refactor:` | Mudança interna sem alterar comportamento |
| `docs:` | Atualização de documentação |

### 4. Abra um Pull Request

Suba sua branch e abra um PR no repositório original:

```bash
git push origin sala/nome-da-sua-sala
```

No PR, descreva brevemente o que sua contribuição adiciona e inclua um screenshot do jogo rodando com sua sala/personagem.

### 5. Mantenha seu fork atualizado

Antes de começar algo novo, sincronize com o repositório original pra evitar conflitos:

```bash
git remote add upstream https://github.com/RamonCout0/Sala33.git
git fetch upstream
git checkout main
git merge upstream/main
```

---

Dúvidas? Olhe os exemplos prontos:
- **Pong** — `server_mods/sala_jogos.py` + `mods/logicas/sala_jogos.js` (minigame 1v1 com física no servidor).
- **Xadrez** — `server_mods/xadrez.py` + `mods/logicas/xadrez.js` (o mais completo: lobby de partidas, matchmaking, relógios, regras de xadrez completas e ranking Elo persistido em arquivo). Bom modelo pra quem quer um jogo de tabuleiro/turnos com sala de espera e placar.

---

## 🛣️ Roadmap — Arquitetura Futura

O projeto atual usa Python no servidor e JavaScript puro no cliente. Isso funciona bem pra comunidades pequenas, mas existe um caminho natural de evolução caso o projeto cresça.

### Microsserviços por sala

A ideia é que cada `server_mod` possa rodar como um serviço independente em **qualquer linguagem**, se comunicando com o core via WebSocket:

```
┌─────────────────────────────────────────┐
│           CORE (Python)                 │
│  - Gerencia salas e jogadores           │
│  - Roteamento de mensagens              │
└────────┬───────────────┬───────────────┘
         │               │
         ▼               ▼
┌──────────────┐  ┌──────────────┐
│ MOD SERVICE  │  │ MOD SERVICE  │
│  (Rust/Go)   │  │  (Node.js)   │
│  Física 60fps│  │  Minigame    │
└──────────────┘  └──────────────┘
```

O protocolo de comunicação seria JSON via WebSocket, com uma interface padronizada:

```json
// Core → Mod
{ "tipo": "evento", "jogador_id": 123, "sala": "minha_sala", "dados": {} }

// Mod → Core
{ "tipo": "broadcast", "sala": "minha_sala", "payload": {} }
```

Isso permitiria mods escritos em **Rust, Go, C#, Node.js, Lua** ou qualquer linguagem que abra um WebSocket.

### Quando isso faz sentido

A arquitetura atual aguenta bem pra comunidades pequenas. A migração pro modelo de microsserviços faz sentido quando:

- Uma sala tem física complexa que sobrecarrega o Python
- O servidor ultrapassa 200 jogadores simultâneos
- Um contribuidor quer implementar algo que Python não entrega com a performance necessária

A migração seria incremental — um `server_mod` por vez, sem precisar reescrever o core.
