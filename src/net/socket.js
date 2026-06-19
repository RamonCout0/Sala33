// =====================================================
//   NET — socket do jogo (detentor + envio)
//   O main.js cria o WebSocket e registra aqui via setSocket().
//   Os módulos de UI mandam mensagens com enviar(), sem depender
//   da variável `ws` global (que é reatribuída a cada conexão).
// =====================================================
let _ws = null;

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
