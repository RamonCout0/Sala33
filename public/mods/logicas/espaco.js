// =====================================================
//   SALA: ESPAÇO  (com luneta + shader GLSL)
//   Demonstra shader REAL (WebGL/GLSL) dentro do sistema de mods.
// =====================================================
//
//   Como funciona: o plugin cria um <canvas> WebGL escondido, compila
//   um fragment shader GLSL (estrelas + nebulosa animada) e a cada frame
//   "estampa" o resultado no canvas 2D do jogo com ctx.drawImage().
//
//   A SALA é um observatório normal (só a luneta). O shader GLSL aparece
//   APENAS quando o jogador aperta [E] na luneta:
//     - [E] na luneta: abre a lente com o shader GLSL + a SUA imagem por cima
//       (mods/salas/espaco.json -> extras.arte; partes transparentes = espaço)
//   Se o navegador não tiver WebGL, cai num campo de estrelas 2D (fallback).
//
//   Posição da luneta e arte: mods/salas/espaco.json -> extras

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_zoom;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.0+vec2(7.1,3.3); a*=0.5; }
  return v;
}
void main(){
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  p/=u_zoom;
  p+=vec2(u_time*0.012, u_time*0.006);
  // nebulosa
  float n =fbm(p*2.5+vec2(0.0,u_time*0.02));
  float n2=fbm(p*1.3-vec2(u_time*0.015,0.0));
  vec3 col=vec3(0.015,0.02,0.05);
  col+=vec3(0.18,0.07,0.32)*pow(n,2.2);
  col+=vec3(0.05,0.12,0.25)*pow(n2,2.0);
  // estrelas (3 camadas) com brilho piscante
  for(float i=0.0;i<3.0;i++){
    float sc=7.0+i*9.0;
    vec2 sp=p*sc;
    float h=hash(floor(sp)+i*23.7);
    float th=0.972;
    if(h>th){
      vec2 g=fract(sp)-0.5;
      float tw=0.6+0.4*sin(u_time*2.5+h*40.0);
      col+=vec3(0.9,0.95,1.0)*smoothstep(0.06,0.0,length(g))*tw*(h-th)/(1.0-th);
    }
  }
  // vinheta sutil
  float vg=smoothstep(1.1,0.2,length((gl_FragCoord.xy-0.5*u_res)/u_res.y));
  col*=mix(0.6,1.0,vg);
  gl_FragColor=vec4(col,1.0);
}`;

SALA33_REGISTRAR("espaco", {
    _modo: "fora",                 // "fora" | "luneta"
    _luneta: { x: 300, y: 150, w: 50, h: 60 },
    _gl: null, _prog: null, _glCanvas: null, _glOk: false,
    _uRes: null, _uTime: null, _uZoom: null,
    _t0: 0,
    _art: null,                    // imagem desenhada mostrada DENTRO da lente

    onEnter(salaConfig) {
        if (salaConfig?.extras?.luneta) this._luneta = salaConfig.extras.luneta;
        this._modo = "fora";
        this._t0 = performance.now();
        // Carrega a arte que aparece pela luneta (por cima do shader).
        // Troque o arquivo apontado em espaco.json -> extras.arte
        const arte = salaConfig?.extras?.arte;
        if (arte) { this._art = new Image(); this._art.src = arte; }
        this._initGL();
    },

    onSair() {
        this._modo = "fora";
        if (this._gl) {
            this._gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
        this._gl = this._prog = this._glCanvas = null;
        this._glOk = false;
    },

    onMensagem() { return false; },

    onTeclaDown(code, ws, meuBicho) {
        if (this._modo === "fora") {
            if (code === "KeyE" && this._perto(meuBicho)) { this._modo = "luneta"; return true; }
            return false;
        }
        // modo luneta
        if (code === "KeyQ" || code === "KeyE") { this._modo = "fora"; return true; }
        return true;   // consome o resto enquanto olha pela luneta
    },

    onFisica() {
        return { bloqueiaMovimento: this._modo === "luneta", tremor: 0 };
    },

    // ── FUNDO: a SALA é um observatório normal ────────
    // (o shader GLSL NÃO fica aqui — só aparece pela luneta).
    // Troque por sua arte definindo "imagem" em espaco.json se quiser.
    renderFundo(ctx) {
        if (this._modo !== "fora") return;

        // chão do observatório (pra o jogador ter onde "pisar")
        ctx.fillStyle = "rgba(16,18,26,0.95)";
        ctx.fillRect(0, 248, 400, 52);
        ctx.fillStyle = "rgba(40,46,60,0.9)";
        ctx.fillRect(0, 246, 400, 3);

        this._desenharLuneta(ctx);   // a luneta (atrás do jogador)
    },

    // ── OVERLAY: prompt [E] ou a lente da luneta ──────
    render(ctx, meuBicho) {
        if (this._modo === "luneta") { this._renderLente(ctx); return; }
        if (this._perto(meuBicho)) {
            const l = this._luneta;
            const lx = l.x + l.w / 2;
            ctx.save();
            ctx.fillStyle = "#161616"; ctx.fillRect(lx - 56, l.y - 22, 112, 14);
            ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.strokeRect(lx - 56, l.y - 22, 112, 14);
            ctx.fillStyle = "#9ad7ff"; ctx.font = "8px monospace"; ctx.textAlign = "center";
            ctx.fillText("[E] OLHAR PELA LUNETA", lx, l.y - 12);
            ctx.restore();
        }
    },

    // ── Helpers de cena ───────────────────────────────
    _perto(meuBicho) {
        const l = this._luneta;
        const cx = meuBicho.x + meuBicho.tamanho / 2;
        const cy = meuBicho.y + meuBicho.tamanho / 2;
        const m = 20;
        return cx > l.x - m && cx < l.x + l.w + m && cy > l.y - m && cy < l.y + l.h + m;
    },

    _desenharLuneta(ctx) {
        const l = this._luneta;
        const cx = l.x + l.w / 2, base = l.y + l.h;
        ctx.save();
        // tripé
        ctx.strokeStyle = "#3a3f48"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx, base - 18); ctx.lineTo(cx - 12, base); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, base - 18); ctx.lineTo(cx + 12, base); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, base - 18); ctx.lineTo(cx, base - 2); ctx.stroke();
        // tubo inclinado
        ctx.translate(cx, base - 20); ctx.rotate(-0.5);
        ctx.fillStyle = "#cfd6dd"; ctx.fillRect(-6, -26, 12, 30);
        ctx.fillStyle = "#8b929b"; ctx.fillRect(-6, -26, 12, 5);
        ctx.fillStyle = "#1b1f26"; ctx.fillRect(-5, -25, 10, 3);
        ctx.restore();
    },

    _renderLente(ctx) {
        const cx = 200, cy = 138, r = 95;
        ctx.save();
        ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 400, 300);
        // tudo recortado no círculo da lente
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
        // 1) o shader (fundo, ampliado)
        this._desenharEspaco(ctx, cx - r, cy - r, r * 2, r * 2, 2.2, true);
        // 2) a SUA imagem desenhada, por cima do shader (partes transparentes = espaço aparece)
        if (this._art && this._art.complete && this._art.naturalWidth) {
            ctx.drawImage(this._art, cx - r, cy - r, r * 2, r * 2);
        }
        ctx.restore();

        // aro da luneta + brilho da lente
        ctx.save();
        ctx.strokeStyle = "#22272f"; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "#5a6472"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        // retícula
        ctx.strokeStyle = "rgba(150,200,255,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#9ad7ff"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText("LUNETA — observando o espaço", cx, cy + r + 24);
        ctx.fillStyle = "#667"; ctx.font = "7px monospace";
        ctx.fillText("[Q] fechar", cx, cy + r + 36);
    },

    // Desenha o espaço (GLSL se houver; senão fallback 2D) num retângulo.
    _desenharEspaco(ctx, dx, dy, dw, dh, zoom, recorteQuadrado) {
        if (this._glOk) {
            this._renderGL(zoom);
            if (recorteQuadrado) {
                // usa o centro 300x300 do canvas GL (sem distorcer no círculo)
                ctx.drawImage(this._glCanvas, 50, 0, 300, 300, dx, dy, dw, dh);
            } else {
                ctx.drawImage(this._glCanvas, dx, dy, dw, dh);
            }
            return;
        }
        this._fallback2D(ctx, dx, dy, dw, dh, zoom);
    },

    // ── WebGL / GLSL ──────────────────────────────────
    _initGL() {
        try {
            const c = document.createElement("canvas");
            c.width = 400; c.height = 300;
            const opts = { preserveDrawingBuffer: true, antialias: true, alpha: false };
            const gl = c.getContext("webgl", opts) || c.getContext("experimental-webgl", opts);
            if (!gl) { this._glOk = false; return; }

            const prog = this._compilar(gl, VERT, FRAG);
            if (!prog) { this._glOk = false; return; }
            gl.useProgram(prog);

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(prog, "p");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

            this._gl = gl; this._prog = prog; this._glCanvas = c;
            this._uRes = gl.getUniformLocation(prog, "u_res");
            this._uTime = gl.getUniformLocation(prog, "u_time");
            this._uZoom = gl.getUniformLocation(prog, "u_zoom");
            this._glOk = true;
        } catch (e) {
            console.warn("[espaco] WebGL indisponível, usando fallback 2D:", e);
            this._glOk = false;
        }
    },

    _compilar(gl, vsSrc, fsSrc) {
        const sh = (tipo, src) => {
            const s = gl.createShader(tipo);
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.error("[espaco] shader:", gl.getShaderInfoLog(s)); return null;
            }
            return s;
        };
        const v = sh(gl.VERTEX_SHADER, vsSrc), f = sh(gl.FRAGMENT_SHADER, fsSrc);
        if (!v || !f) return null;
        const p = gl.createProgram();
        gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("[espaco] link:", gl.getProgramInfoLog(p)); return null;
        }
        return p;
    },

    _renderGL(zoom) {
        const gl = this._gl;
        gl.viewport(0, 0, this._glCanvas.width, this._glCanvas.height);
        gl.uniform2f(this._uRes, this._glCanvas.width, this._glCanvas.height);
        gl.uniform1f(this._uTime, (performance.now() - this._t0) / 1000);
        gl.uniform1f(this._uZoom, zoom);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    // Campo de estrelas simples se não houver WebGL (sem shader).
    _fallback2D(ctx, dx, dy, dw, dh, zoom) {
        const t = (performance.now() - this._t0) / 1000;
        ctx.save();
        ctx.fillStyle = "#06070f"; ctx.fillRect(dx, dy, dw, dh);
        for (let i = 0; i < 90; i++) {
            const h = Math.sin(i * 127.1) * 43758.5;
            const fx = ((h - Math.floor(h)) * dw);
            const g = Math.sin(i * 311.7) * 24634.6;
            const fy = (((g - Math.floor(g)) + t * 0.01 * zoom) % 1) * dh;
            const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
            ctx.fillStyle = `rgba(200,220,255,${0.3 + 0.6 * tw})`;
            ctx.fillRect(dx + fx, dy + fy, 1.5, 1.5);
        }
        ctx.restore();
    },
});
