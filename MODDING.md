# 🧩 GUIA DE MODDING — SALA 33

Bem-vindo! Este documento explica como adicionar conteúdo novo ao SALA 33 sem mexer no engine principal.

A ideia é simples: tudo o que define o mundo do jogo vive em duas pastas — `public/mods/` (cliente) e `server_mods/` (servidor). Quem quiser fazer "sua sala" só precisa criar uns arquivos novos e listá-los no manifest.

---

## 📁 Estrutura do projeto

```
Sala33/
├── server.py                       ← engine do servidor (não mexer)
├── server_mods/                    ← mecânicas server-side por sala
│   ├── sala_jogos.py               (exemplo: Pong)
│   └── o_quarto.py                 (exemplo: Duelo de Aura)
└── public/
    ├── index.html
    ├── game.js                     ← engine do cliente (não mexer)
    ├── assets/
    │   ├── maps/                   ← imagens de fundo das salas
    │   ├── characters/             ← sprites dos personagens
    │   ├── music/                  ← trilhas
    │   └── artworks/               ← obras do museu, etc
    └── mods/
        ├── manifest.json           ← lista o que carregar
        ├── personagens.json        ← roster de personagens
        ├── salas/                  ← um JSON por sala
        │   └── *.json
        └── logicas/                ← plugins JS client-side por sala
            └── *.js
```

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

- Fundo: `public/assets/maps/minha_sala.png`
- Música: `public/assets/music/minha_sala.mp3` (opcional)

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

    render(ctx, meuBicho, outrosJogadores, imagensSprites, tamSprite) {
        // Desenhe overlays customizados aqui.
        // O fundo da sala e os jogadores já foram desenhados.
    },
});
```

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

## 🛠️ Reset rápido para testar

```bash
python server.py
```

Os JSONs e plugins são servidos com `Cache-Control: no-cache`, então é só recarregar (F5) o browser pra ver mudanças. Mudanças em `server.py` ou `server_mods/*.py` exigem reiniciar o servidor.

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

Dúvidas? Olhe `server_mods/sala_jogos.py` e `mods/logicas/sala_jogos.js` — são os exemplos mais completos.
