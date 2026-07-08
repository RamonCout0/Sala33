// =====================================================
//   NET — socket do jogo (detentor + envio)
//   O main.js cria o WebSocket e registra aqui via setSocket().
//   Os módulos de UI mandam mensagens com enviar(), sem depender
//   da variável `ws` global (que é reatribuída a cada conexão).
// =====================================================
let _ws = null;

// URL do WebSocket: em rede local vai pra :8080; em produção usa o mesmo host (porta única).
export function _wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1"
        || location.hostname.startsWith("192.168.") || location.hostname.startsWith("10.");
    return isLocal ? `ws://${location.hostname}:8080` : `${proto}//${location.host}`;
}

export function setSocket(ws) {
    _ws = ws;
}

/** Envia um payload JSON pelo socket. Retorna true se mandou, false se offline. */
export function enviar(payload) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify(payload));
        return true;
    }
    return false;
}
