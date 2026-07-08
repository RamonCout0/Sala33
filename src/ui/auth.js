// =====================================================
//   UI — AUTENTICAÇÃO / CONTAS
//   Abas do menu (convidado | entrar | criar | esqueci) e o fluxo
//   de auth via WebSocket dedicado (registrar / autenticar / reset).
//   Não mexe no estado do jogo: delega "entrar" via callbacks
//   injetados (conectarConvidado / aoEntrarComConta).
// =====================================================
import { _wsUrl } from "../net/socket.js";
import { MAPAS } from "../world/config.js";

let _conectarConvidado = () => {};
let _aoEntrarComConta = () => {};

/** Injeta do main.js: entrar como convidado e entrar com conta (user, token). */
export function initAuth({ conectarConvidado, aoEntrarComConta }) {
    if (conectarConvidado) _conectarConvidado = conectarConvidado;
    if (aoEntrarComConta) _aoEntrarComConta = aoEntrarComConta;
}

let modoAuth = "convidado";   // convidado | entrar | criar | esqueci
let wsAuth = null;            // socket temporário só pra auth

export function _authMsg(texto, tipo) {
    const el = document.getElementById("authMsg");
    if (!el) return;
    el.textContent = texto;
    el.className = tipo || "";
    if (!texto) el.className = "";
}

export function trocarAba(modo) {
    modoAuth = modo;
    _authMsg("", "");
    document.querySelectorAll(".auth-tab").forEach(t => {
        t.classList.toggle("ativa", t.dataset.modo === modo);
    });
    const contaFields = document.getElementById("contaFields");
    const guestField  = document.getElementById("username");
    const seletorSkin = document.querySelector(".selector-container");
    const emailField  = document.getElementById("contaEmail");
    const linkEsqueci = document.getElementById("linkEsqueciSenha");
    const resetFields = document.getElementById("resetFields");
    const btn         = document.getElementById("btnEntrar");

    contaFields.style.display = "none";
    guestField.style.display  = "none";
    if (seletorSkin) seletorSkin.style.display = "none";
    if (emailField)  emailField.style.display  = "none";
    if (linkEsqueci) linkEsqueci.style.display = "none";
    if (resetFields) resetFields.style.display = "none";

    if (modo === "convidado") {
        guestField.style.display = "block";
        if (seletorSkin) seletorSkin.style.display = "flex";
        btn.textContent = "ENTRAR";
    } else if (modo === "entrar") {
        contaFields.style.display = "block";
        if (linkEsqueci) linkEsqueci.style.display = "block";
        btn.textContent = "ENTRAR COM CONTA";
    } else if (modo === "criar") {
        contaFields.style.display = "block";
        if (emailField) emailField.style.display = "block";
        if (seletorSkin) seletorSkin.style.display = "flex";
        btn.textContent = "CRIAR E ENTRAR";
    } else if (modo === "esqueci") {
        if (resetFields) resetFields.style.display = "block";
        btn.textContent = "ENVIAR RECUPERAÇÃO";
    }
}
window.trocarAba = trocarAba;

// Roteador do botão ENTRAR conforme a aba ativa
export function acaoMenu() {
    if (modoAuth === "convidado") {
        _conectarConvidado();
    } else if (modoAuth === "entrar" || modoAuth === "criar") {
        autenticarOuCriar(modoAuth === "criar" ? "registrar" : "autenticar");
    } else if (modoAuth === "esqueci") {
        solicitarReset();
    }
}
window.acaoMenu = acaoMenu;

// Abre um socket dedicado de auth e manda uma mensagem, tratando a resposta.
function _authSocket(payload, onResp) {
    const sock = new WebSocket(_wsUrl());
    sock.onopen = () => sock.send(JSON.stringify(payload));
    sock.onmessage = (event) => {
        let dados;
        try { dados = JSON.parse(event.data); } catch { return; }
        onResp(dados, sock);
    };
    sock.onerror = () => onResp({ tipo: "_erro_conexao" }, sock);
    return sock;
}

// Solicita recuperação de senha (resposta sempre neutra)
export function solicitarReset() {
    const username = document.getElementById("resetUser").value.trim().toUpperCase();
    if (username.length < 3) return _authMsg("Digite seu usuário.", "erro");
    const btn = document.getElementById("btnEntrar");
    btn.disabled = true; btn.textContent = "ENVIANDO...";
    _authSocket({ tipo: "solicitar_reset", username }, (dados, sock) => {
        if (dados.tipo === "reset_solicitado") {
            _authMsg(dados.mensagem || "Se a conta existir, enviamos instruções.", "ok");
            sock.close();
            btn.disabled = false; btn.textContent = "ENVIAR RECUPERAÇÃO";
        } else if (dados.tipo === "_erro_conexao") {
            _authMsg("Erro de conexão.", "erro");
            btn.disabled = false; btn.textContent = "ENVIAR RECUPERAÇÃO";
        }
    });
}
window.solicitarReset = solicitarReset;

// Faz registro OU login via WebSocket dedicado; ao dar certo, delega ao main.js
export function autenticarOuCriar(tipo) {
    const username = document.getElementById("contaUser").value.trim().toUpperCase();
    const password = document.getElementById("contaPass").value;
    const email = (document.getElementById("contaEmail")?.value || "").trim();
    if (username.length < 3) return _authMsg("Usuário precisa de 3+ caracteres.", "erro");
    if (password.length < 6) return _authMsg("Senha precisa de 6+ caracteres.", "erro");
    if (!Object.keys(MAPAS).length) return _authMsg("Configs carregando, aguarde...", "erro");

    const btn = document.getElementById("btnEntrar");
    btn.disabled = true;
    btn.textContent = tipo === "registrar" ? "CRIANDO..." : "ENTRANDO...";
    _authMsg("", "");

    // Payload: inclui email só no registro (e só se preenchido)
    const payload = { tipo, username, password };
    if (tipo === "registrar" && email) payload.email = email;

    wsAuth = new WebSocket(_wsUrl());
    wsAuth.onopen = () => wsAuth.send(JSON.stringify(payload));

    wsAuth.onmessage = (event) => {
        let dados;
        try { dados = JSON.parse(event.data); } catch { return; }

        if (dados.tipo === "auth_ok") {
            wsAuth.close(); wsAuth = null;
            btn.disabled = false;
            // Delega ao main.js: salva token/estado e entra no jogo
            _aoEntrarComConta(dados.user, dados.token);
        }
        else if (dados.tipo === "auth_erro") {
            _authMsg(dados.mensagem || "Falha na autenticação.", "erro");
            wsAuth.close(); wsAuth = null;
            btn.disabled = false;
            btn.textContent = tipo === "registrar" ? "CRIAR E ENTRAR" : "ENTRAR COM CONTA";
        }
    };

    wsAuth.onerror = () => {
        _authMsg("Erro de conexão com o servidor.", "erro");
        btn.disabled = false;
        btn.textContent = tipo === "registrar" ? "CRIAR E ENTRAR" : "ENTRAR COM CONTA";
    };
}
window.autenticarOuCriar = autenticarOuCriar;
