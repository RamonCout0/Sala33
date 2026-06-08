# 🕹️ SALA 33 — Estudo de Sistemas Distribuídos com WebSockets

## 📖 Sobre o Projeto

O **SALA 33** é um ambiente multiplayer em tempo real desenvolvido como projeto da disciplina de **Sistemas Distribuídos**.

O objetivo principal do projeto é aplicar conceitos de comunicação distribuída através de um ambiente virtual interativo inspirado em RPGs retrô, permitindo que múltiplos clientes compartilhem estados, eventos e interações em tempo real utilizando WebSockets.

Ao invés de utilizar apenas exemplos tradicionais de chat, o projeto simula um pequeno mundo virtual composto por salas interconectadas, possibilitando a experimentação prática de sincronização de estados, concorrência, comunicação assíncrona e gerenciamento de múltiplos usuários.

---

# 🎓 Conceitos de Sistemas Distribuídos Aplicados

## Comunicação Cliente-Servidor

* Comunicação persistente utilizando WebSockets.
* Troca bidirecional de mensagens em tempo real.
* Protocolo baseado em mensagens JSON.
* Atualizações contínuas entre clientes e servidor.

## Estado Compartilhado

O servidor mantém o estado global da aplicação:

* Jogadores conectados.
* Salas ativas.
* Estado dos minigames.
* Mensagens de chat.
* Eventos compartilhados.

Os clientes recebem apenas as atualizações necessárias para manter a consistência local.

## Concorrência

O sistema atende múltiplos usuários simultaneamente através de:

* `asyncio`
* Tarefas assíncronas
* Filas de mensagens por conexão

## Distribuição de Eventos

Eventos produzidos por um cliente são propagados aos demais participantes da mesma sala:

* Movimentação dos jogadores
* Mensagens de chat
* Entrada e saída de usuários
* Atualizações dos minigames

## Consistência de Estado

O servidor atua como autoridade central para:

* Posições dos jogadores
* Estados dos minigames
* Pontuações
* Eventos globais

Evitando divergências entre clientes.

## Escalabilidade

O projeto separa responsabilidades entre:

* Servidor HTTP para arquivos estáticos
* Servidor WebSocket para comunicação em tempo real

Permitindo melhor organização e distribuição de carga.

---

# 🎯 Objetivos de Aprendizagem

Durante o desenvolvimento foram explorados conceitos como:

### WebSockets

* Conexões persistentes entre cliente e servidor.
* Troca de mensagens JSON.
* Broadcast para múltiplos usuários.
* Gerenciamento de conexões simultâneas.

### Multiplayer

* Sincronização de movimento dos jogadores.
* Compartilhamento de estados.
* Atualizações em tempo real.
* Eventos sincronizados.

### Arquitetura Cliente-Servidor

* Cliente responsável pela renderização.
* Servidor responsável pela lógica global.
* Controle de salas independentes.
* Comunicação assíncrona.

### Programação Assíncrona

Utilização de:

* asyncio
* websockets

Para processar múltiplos eventos simultaneamente sem bloquear a aplicação.

---

# 🌐 Funcionalidades Implementadas

## Hub Multiplayer

Ambiente virtual onde vários jogadores podem:

* Entrar simultaneamente.
* Conversar em tempo real.
* Explorar diferentes mapas.
* Participar de atividades compartilhadas.

## Sistema de Salas

O mundo é dividido em ambientes independentes:

* 🏠 The Hub
* 🎮 Sala de Jogos
* 🖼️ Museu
* 🌲 Floresta
* 🛏️ O Quarto

Cada sala possui seus próprios jogadores e eventos.

## Sistema de Chat

* Chat em tempo real.
* Balões de fala sobre os personagens.
* Indicador de digitação.
* Sistema de emotes rápidos.
* Conversão automática de atalhos para expressões visuais.

## Sistema de Personagens

Cada jogador pode escolher uma skin ao entrar.

Personagens disponíveis:

* Cinza Guy
* Bailarina
* Gato
* Cachorro
* Nututu
* Portalel
* Iluminus

As informações são sincronizadas para todos os jogadores da mesma sala.

## Sistema de Áudio Dinâmico

Cada ambiente possui sua própria trilha sonora.

As músicas são carregadas apenas quando necessárias utilizando Lazy Loading, reduzindo:

* Consumo de memória
* Uso de banda
* Tempo de carregamento inicial

---

# 🎮 Minigames

## 🏓 Pong Multiplayer

Implementação do clássico Pong utilizando WebSockets.

Permite estudar:

* Sincronização de objetos
* Compartilhamento de estados
* Controle simultâneo de usuários
* Atualização em tempo real

## 🔥 Duelo de Aura

Minigame competitivo baseado em eventos sincronizados.

Características:

* Sistema competitivo em tempo real
* Atualização contínua de estado
* Efeitos visuais compartilhados
* Screen Shake global
* Sistema de partículas dinâmicas

---

# ⚙️ Arquitetura

## Frontend

Tecnologias utilizadas:

* HTML5
* CSS3
* JavaScript Vanilla
* Canvas 2D

Responsável por:

* Interface gráfica
* Renderização
* Captura de entrada do usuário
* Reprodução de áudio

## Backend

Tecnologias utilizadas:

* Python 3
* asyncio
* websockets
* http.server
* socketserver.ThreadingTCPServer

Responsável por:

* Gerenciamento de conexões
* Controle das salas
* Sincronização dos jogadores
* Estado dos minigames
* Distribuição de eventos

---

# 🚀 Como Executar

## Instalar dependências

```bash
pip install -r requirements.txt
```

## Executar o servidor

```bash
python server.py
```

O sistema iniciará automaticamente:

| Serviço   | Porta |
| --------- | ----- |
| HTTP      | 8000  |
| WebSocket | 8080  |

## Acessar

Abra o navegador:

```text
http://SEU_IP_LOCAL:8000
```

Exemplo:

```text
http://192.168.0.10:8000
```

Todos os dispositivos conectados à mesma rede poderão acessar o ambiente multiplayer.

---

# 🎮 Controles

| Ação              | Tecla         |
| ----------------- | ------------- |
| Movimentação      | WASD ou Setas |
| Interagir         | E             |
| Chat              | Enter         |
| Sair de interação | Q             |
| Duelo de Aura     | Espaço        |
| Debug             | F2            |

---

# 📚 Conceitos Estudados

* Sistemas Distribuídos
* WebSockets
* Programação Assíncrona
* Multiplayer em Tempo Real
* Broadcast de Eventos
* Gerenciamento de Estado
* Canvas API
* Game Loop
* Sincronização Cliente-Servidor
* Lazy Loading
* Threading em Python

---

# 📌 Considerações Finais

O SALA 33 foi desenvolvido como projeto prático da disciplina de Sistemas Distribuídos com o objetivo de aplicar conceitos de comunicação em tempo real, sincronização de estado, concorrência e arquitetura cliente-servidor.

A utilização de WebSockets permitiu implementar um ambiente multiplayer interativo capaz de manter múltiplos clientes sincronizados através de um servidor central autoritativo, demonstrando na prática desafios comuns encontrados em aplicações distribuídas modernas.
