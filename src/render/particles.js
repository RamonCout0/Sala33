// =====================================================
//   PARTÍCULAS DE FUMAÇA (efeito de chegada por TP)
//   Puffs cinza com gradiente radial (bordas suaves) +
//   uma onda de choque que expande no ponto do teleporte.
//   Renderizado no canvas; o ctx é injetado via initParticles.
// =====================================================
let ctx = null;

/** Injeta o contexto 2D do canvas (chamado uma vez no boot). */
export function initParticles(context) {
    ctx = context;
}

let fumacas = [];   // [{x, y, vx, vy, vida, decay, tam, giro, fase}]
let ondas = [];     // [{x, y, r, vida}] — anéis de choque

export function spawnFumaca(cx, cy) {
    // cx, cy = centro do jogador que chegou
    const N = 20;
    for (let i = 0; i < N; i++) {
        const ang = (Math.PI * 2 * i) / N + Math.random() * 0.6;
        const vel = 0.4 + Math.random() * 1.1;
        fumacas.push({
            x: cx + (Math.random() - 0.5) * 8,
            y: cy + (Math.random() - 0.5) * 8,
            vx: Math.cos(ang) * vel,
            vy: Math.sin(ang) * vel - 0.5,   // tendência a subir
            vida: 1.0,
            decay: 0.010 + Math.random() * 0.012,
            tam: 4 + Math.random() * 8,
            giro: (Math.random() - 0.5) * 0.05,  // velocidade do wobble
            fase: Math.random() * Math.PI * 2,   // fase do wobble
        });
    }
    // Onda de choque no ponto de chegada (impacto do teleporte)
    ondas.push({ x: cx, y: cy, r: 4, vida: 1.0 });

    if (fumacas.length > 240) fumacas = fumacas.slice(-240);   // teto de segurança
}

export function atualizarFumacas() {
    for (const f of fumacas) {
        f.fase += f.giro;
        f.x += f.vx + Math.sin(f.fase) * 0.3;   // turbulência horizontal leve
        f.y += f.vy;
        f.vy += 0.006;          // leve gravidade que desacelera a subida
        f.vx *= 0.95;           // arrasto
        f.tam += 0.4;           // expande
        f.vida -= f.decay;
    }
    fumacas = fumacas.filter(f => f.vida > 0);

    for (const o of ondas) {
        o.r += 2.2;             // anel cresce
        o.vida -= 0.045;
    }
    ondas = ondas.filter(o => o.vida > 0);
}

export function desenharFumacas() {
    if (!ctx || (!fumacas.length && !ondas.length)) return;
    ctx.save();

    // Onda de choque (anel) primeiro, atrás das partículas
    for (const o of ondas) {
        ctx.globalAlpha = Math.max(0, o.vida) * 0.4;
        ctx.strokeStyle = "rgb(220, 220, 235)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.globalAlpha = 1;
    // Partículas com gradiente radial → bordas suaves (não mais círculos chapados)
    for (const f of fumacas) {
        const vidaEase = f.vida * f.vida;                  // fade ease-out
        const alpha = vidaEase * 0.55;
        const tom = 160 + Math.floor((1 - f.vida) * 70);   // clareia ao sumir
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.tam);
        g.addColorStop(0, `rgba(${tom},${tom},${tom + 8},${alpha})`);
        g.addColorStop(1, `rgba(${tom},${tom},${tom + 8},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.tam, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}
