// =====================================================
//   UI — PAINEL SOCIAL (amigos + favoritos + pedidos + PV)
//   O estado social vive aqui (estadoSocial) e é compartilhado:
//   os handlers de mensagem do main.js escrevem nele via as
//   propriedades, e este módulo lê/renderiza. Dependências do
//   jogo (meuBicho, sala atual, etc.) entram via initSocial().
// =====================================================
import { enviar } from "../net/socket.js";
import { MAPAS } from "../world/config.js";
import { traduzirEmotes, horaAtualBrasil, _aplicarGrayscaleEmojis } from "./chat.js";

// Estado compartilhado (main.js alimenta via estadoSocial.X nos handlers)
export const estadoSocial = {
    amigos: [],        // [{id, username, sprite_id}]
    favoritos: [],     // ["the_hub", ...]
    pedidos: [],       // pedidos recebidos [{id, username, sprite_id}]
    online: new Set(), // ids de amigos online agora
    likes: {},         // { room_id: {total, curtiu} }
    pvAtual: null,     // {id, username} do amigo com quem converso
    pvHistorico: {},   // { friendId: [ {de, texto, ts, eu} ] }
};

// Dependências injetadas pelo main.js
let _meuBicho = null;
let _getMinhaSala = () => "";
let _getContaAtiva = () => false;
let _getOutros = () => ({});

export function initSocial({ meuBicho, getMinhaSala, getContaAtiva, getOutrosJogadores }) {
    _meuBicho = meuBicho;
    if (getMinhaSala) _getMinhaSala = getMinhaSala;
    if (getContaAtiva) _getContaAtiva = getContaAtiva;
    if (getOutrosJogadores) _getOutros = getOutrosJogadores;
}

export function toggleSocial() {
    const painel = document.getElementById("socialPanel");
    if (!painel) return;
    painel.classList.toggle("aberto");
    if (painel.classList.contains("aberto")) {
        // Pede lista atualizada ao abrir (traz status online + pedidos)
        if (_getContaAtiva()) enviar({ tipo: "listar_amigos" });
        renderizarSocial();
    }
}
window.toggleSocial = toggleSocial;

export function _socialMsg(texto, tipo) {
    const el = document.getElementById("socialMsg");
    if (!el) return;
    el.textContent = texto;
    el.className = tipo || "";
    if (texto) setTimeout(() => { el.textContent = ""; el.className = ""; }, 4000);
}

export function adicionarAmigo() {
    const input = document.getElementById("inputAddAmigo");
    const nome = input.value.trim().toUpperCase();
    if (!nome) return;
    if (nome === _meuBicho.username) return _socialMsg("Você não pode se adicionar.", "erro");
    if (enviar({ tipo: "add_amigo", username: nome })) input.value = "";
}
window.adicionarAmigo = adicionarAmigo;

export function aceitarPedido(fromId) {
    enviar({ tipo: "aceitar_pedido", from_id: fromId });
}
window.aceitarPedido = aceitarPedido;

export function recusarPedido(fromId) {
    enviar({ tipo: "recusar_pedido", from_id: fromId });
    // Remove localmente na hora
    estadoSocial.pedidos = estadoSocial.pedidos.filter(p => p.id !== fromId);
    renderizarSocial();
}
window.recusarPedido = recusarPedido;

export function removerAmigo(friendId) {
    enviar({ tipo: "remover_amigo", friend_id: friendId });
}
window.removerAmigo = removerAmigo;

export function tpAmigo(friendId) {
    enviar({ tipo: "tp_amigo", friend_id: friendId });
}
window.tpAmigo = tpAmigo;

export function toggleFavoritoSalaAtual() {
    enviar({ tipo: "toggle_favorito", room_id: _getMinhaSala() });
}
window.toggleFavoritoSalaAtual = toggleFavoritoSalaAtual;

export function toggleLikeSalaAtual() {
    enviar({ tipo: "toggle_like", room_id: _getMinhaSala() });
}
window.toggleLikeSalaAtual = toggleLikeSalaAtual;

// Pede ao servidor o estado de likes da sala atual (total + se eu curti)
export function pedirEstadoSala() {
    const sala = _getMinhaSala();
    if (sala) enviar({ tipo: "estado_sala", room_id: sala });
}

// Amigo online: ou está na lista online (servidor) ou na minha sala
function _amigoEstaOnline(amigo) {
    if (estadoSocial.online.has(amigo.id)) return true;
    const outros = _getOutros();
    for (const id in outros) {
        if (outros[id].username === amigo.username) return true;
    }
    return false;
}

// ---------- CHAT PRIVADO (PV) ----------
export function abrirPV(friendId, friendName) {
    estadoSocial.pvAtual = { id: friendId, username: friendName };
    if (!estadoSocial.pvHistorico[friendId]) estadoSocial.pvHistorico[friendId] = [];
    const painel = document.getElementById("pvPanel");
    const titulo = document.getElementById("pvTitulo");
    if (titulo) titulo.textContent = `// PV: ${friendName}`;
    if (painel) painel.classList.add("aberto");
    renderizarPV();
    setTimeout(() => document.getElementById("pvInput")?.focus(), 80);
}
window.abrirPV = abrirPV;

export function fecharPV() {
    document.getElementById("pvPanel")?.classList.remove("aberto");
    estadoSocial.pvAtual = null;
}
window.fecharPV = fecharPV;

export function enviarPV() {
    const input = document.getElementById("pvInput");
    if (!input || !estadoSocial.pvAtual) return;
    const texto = input.value.trim();
    if (!texto) return;
    if (enviar({ tipo: "pv", friend_id: estadoSocial.pvAtual.id, texto: traduzirEmotes(texto) }))
        input.value = "";
}
window.enviarPV = enviarPV;

export function _registrarPV(friendId, de, texto, eu) {
    if (!estadoSocial.pvHistorico[friendId]) estadoSocial.pvHistorico[friendId] = [];
    estadoSocial.pvHistorico[friendId].push({ de, texto, ts: horaAtualBrasil(), eu });
    if (estadoSocial.pvHistorico[friendId].length > 100) estadoSocial.pvHistorico[friendId].shift();
    // Se o PV está aberto com esse amigo, re-renderiza
    if (estadoSocial.pvAtual && estadoSocial.pvAtual.id === friendId) renderizarPV();
}

export function renderizarPV() {
    const box = document.getElementById("pvBox");
    if (!box || !estadoSocial.pvAtual) return;
    const hist = estadoSocial.pvHistorico[estadoSocial.pvAtual.id] || [];
    box.innerHTML = "";
    if (hist.length === 0) {
        const vazio = document.createElement("div");
        vazio.className = "pv-sistema";
        vazio.textContent = `Início da conversa com ${estadoSocial.pvAtual.username}.`;
        box.appendChild(vazio);
    } else {
        hist.forEach(m => {
            const div = document.createElement("div");
            div.className = "pv-msg" + (m.eu ? " eu" : "");
            const hora = document.createElement("span");
            hora.className = "pv-hora";
            hora.textContent = m.ts;
            const de = document.createElement("span");
            de.className = "pv-de";
            de.textContent = (m.eu ? "você" : m.de) + ": ";
            div.appendChild(hora);
            div.appendChild(de);
            div.appendChild(document.createTextNode(m.texto));
            if (window.twemoji) {
                twemoji.parse(div, { base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/", folder: "72x72", ext: ".png" });
                _aplicarGrayscaleEmojis(div);
            }
            box.appendChild(div);
        });
    }
    box.scrollTop = box.scrollHeight;
}

export function renderizarSocial() {
    const minhaSala = _getMinhaSala();

    // Botão de favoritar reflete o estado da sala atual
    const btnFav = document.getElementById("btnFavSala");
    if (btnFav) {
        const favoritada = estadoSocial.favoritos.includes(minhaSala);
        btnFav.classList.toggle("ativo", favoritada);
        btnFav.textContent = favoritada
            ? `★ SALA FAVORITADA (${minhaSala})`
            : `☆ FAVORITAR ESTA SALA`;
    }

    // Botão de like reflete total + se eu curti
    const btnLike = document.getElementById("btnLikeSala");
    const likeCount = document.getElementById("likeCount");
    if (btnLike) {
        const info = estadoSocial.likes[minhaSala] || { total: 0, curtiu: false };
        if (likeCount) likeCount.textContent = info.total;
        btnLike.classList.toggle("ativo", !!info.curtiu);
        btnLike.innerHTML = (info.curtiu ? "♥" : "♡") + ` <span id="likeCount">${info.total}</span> LIKES`;
    }

    // Pedidos de amizade recebidos
    const secaoPedidos = document.getElementById("secaoPedidos");
    const listaPedidos = document.getElementById("listaPedidos");
    const pedidosCount = document.getElementById("pedidosCount");
    if (pedidosCount) pedidosCount.textContent = estadoSocial.pedidos.length;
    if (secaoPedidos) secaoPedidos.style.display = estadoSocial.pedidos.length > 0 ? "block" : "none";
    if (listaPedidos) {
        listaPedidos.innerHTML = "";
        estadoSocial.pedidos.forEach(p => {
            const item = document.createElement("div");
            item.className = "pedido-item";
            const nome = document.createElement("span");
            nome.textContent = p.username;
            const acoes = document.createElement("div");
            acoes.className = "pedido-acoes";
            const aceitar = document.createElement("button");
            aceitar.className = "pedido-btn pedido-aceitar";
            aceitar.textContent = "✓";
            aceitar.title = "Aceitar";
            aceitar.onclick = () => aceitarPedido(p.id);
            const recusar = document.createElement("button");
            recusar.className = "pedido-btn pedido-recusar";
            recusar.textContent = "×";
            recusar.title = "Recusar";
            recusar.onclick = () => recusarPedido(p.id);
            acoes.appendChild(aceitar);
            acoes.appendChild(recusar);
            item.appendChild(nome);
            item.appendChild(acoes);
            listaPedidos.appendChild(item);
        });
    }

    // Lista de amigos
    const lista = document.getElementById("listaAmigos");
    const count = document.getElementById("amigosCount");
    if (count) count.textContent = estadoSocial.amigos.length;
    if (lista) {
        if (estadoSocial.amigos.length === 0) {
            lista.innerHTML = `<div class="social-vazio">Nenhum amigo ainda.</div>`;
        } else {
            lista.innerHTML = "";
            estadoSocial.amigos.forEach(a => {
                const online = _amigoEstaOnline(a);
                const item = document.createElement("div");
                item.className = "amigo-item";

                const nome = document.createElement("div");
                nome.className = "nome";
                const dot = document.createElement("span");
                dot.className = online ? "amigo-online" : "amigo-offline";
                nome.appendChild(dot);
                nome.appendChild(document.createTextNode(a.username));

                const acoes = document.createElement("div");
                acoes.className = "amigo-acoes";

                // Botão TP (só ativo se online)
                const btnTp = document.createElement("button");
                btnTp.className = "amigo-btn-tp";
                btnTp.textContent = "TP";
                btnTp.title = online ? `Teleportar até ${a.username}` : "Amigo offline";
                btnTp.disabled = !online;
                btnTp.onclick = () => tpAmigo(a.id);

                // Botão PV
                const btnPv = document.createElement("button");
                btnPv.className = "amigo-btn-pv";
                btnPv.textContent = "PV";
                btnPv.title = `Conversar com ${a.username}`;
                btnPv.onclick = () => abrirPV(a.id, a.username);

                // Botão remover
                const btnRm = document.createElement("button");
                btnRm.className = "social-btn-acao remove";
                btnRm.textContent = "×";
                btnRm.title = "Remover amigo";
                btnRm.onclick = () => removerAmigo(a.id);

                acoes.appendChild(btnTp);
                acoes.appendChild(btnPv);
                acoes.appendChild(btnRm);
                item.appendChild(nome);
                item.appendChild(acoes);
                lista.appendChild(item);
            });
        }
    }

    // Lista de favoritos
    const favBox = document.getElementById("listaFavoritos");
    if (favBox) {
        if (estadoSocial.favoritos.length === 0) {
            favBox.innerHTML = `<div class="social-vazio">Nenhuma sala favoritada.</div>`;
        } else {
            favBox.innerHTML = "";
            estadoSocial.favoritos.forEach(room => {
                const nomeSala = MAPAS[room]?.nome || room;
                const item = document.createElement("div");
                item.className = "fav-item";
                const nome = document.createElement("div");
                nome.className = "nome";
                nome.textContent = `★ ${nomeSala}`;
                const btn = document.createElement("button");
                btn.className = "social-btn-acao remove";
                btn.textContent = "×";
                btn.title = "Desfavoritar";
                btn.onclick = () => enviar({ tipo: "toggle_favorito", room_id: room });
                item.appendChild(nome);
                item.appendChild(btn);
                favBox.appendChild(item);
            });
        }
    }
}
