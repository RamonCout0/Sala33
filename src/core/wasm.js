// =====================================================
//   WASM — Physics Engine
//   Carrega public/wasm/physics.wasm e expõe:
//     Wasm.update_particles(ptr, count, dt)
//     Wasm.lerp_positions(src, dst, out, n, t)
//     Wasm.check_rect_overlap(...)
//     Wasm.snow_update(ptr, count, speed_mult, w, h)
// =====================================================
export const Wasm = {
    ready: false,
    _inst: null,
    _mem: null,
    // Buffers alocados dentro da memória do módulo
    _ptrs: {},

    async init() {
        try {
            const res = await fetch('/wasm/physics.wasm');
            // Se o arquivo não existe (404) ou foi bloqueado, falha rápido e limpo.
            // Sem esse check, o browser tenta compilar a página de erro como WASM
            // e joga um erro confuso de "magic word".
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(buf, {
                env: { memory: new WebAssembly.Memory({ initial: 4 }) }
            });
            this._inst = instance.exports;
            this._mem  = instance.exports.memory;
            this.ready = true;
            console.log('[WASM] physics.wasm carregado ✓');
        } catch (e) {
            console.info('[WASM] fallback JS ativo:', e.message);
        }
    },

    _alloc(floats) {
        // Retorna um ponteiro pra um bloco de floats na memória do WASM
        // Simplificado: usa o heap base do módulo
        return 0; // será expandido quando necessário
    },

    // Chama update_particles no WASM ou faz fallback JS
    updateParticles(arr, dt) {
        if (!this.ready || arr.length === 0) return arr;
        // Cria Float32Array view na memória do WASM
        const count = arr.length;
        const mem   = new Float32Array(this._mem.buffer, 0, count * 8);
        for (let i = 0; i < count; i++) {
            const p = arr[i], base = i * 8;
            mem[base]   = p.x;    mem[base+1] = p.y;
            mem[base+2] = p.vx;   mem[base+3] = p.vy;
            mem[base+4] = p.vida; mem[base+5] = p.decay;
            mem[base+6] = p.tam;
            // flags: bit0=ativo, bit1=tem_gravidade, bit2=tem_drift
            let flags = 1; // sempre ativo
            if (p.gravidade) flags |= 2;
            if (p.drift)     flags |= 4;
            mem[base+7] = flags;
        }
        this._inst.update_particles(0, count, dt);
        // Lê de volta
        for (let i = 0; i < count; i++) {
            const p = arr[i], base = i * 8;
            p.x    = mem[base];   p.y    = mem[base+1];
            p.vx   = mem[base+2]; p.vy   = mem[base+3];
            p.vida = mem[base+4]; p.tam  = mem[base+6];
        }
        return arr.filter(p => p.vida > 0);
    },

    // Colisão rect-rect (WASM ou fallback)
    checkRectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
        if (this.ready) {
            return this._inst.check_rect_overlap(ax,ay,aw,ah,bx,by,bw,bh) === 1;
        }
        return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
    },

    // Ponto em rect (WASM ou fallback)
    checkPointInRect(px, py, rx, ry, rw, rh) {
        if (this.ready) {
            return this._inst.check_point_in_rect(px,py,rx,ry,rw,rh) === 1;
        }
        return px >= rx && px <= rx+rw && py >= ry && py <= ry+rh;
    },
};
