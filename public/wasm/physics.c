/*
 * Sala33 — Physics Engine (WASM)
 * Source: wasm/physics.c
 * Output: public/wasm/physics.wasm
 *
 * Compilar:
 *   clang --target=wasm32-unknown-unknown -O2 -nostdlib \
 *         -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
 *         -o public/wasm/physics.wasm wasm/physics.c
 *
 * Ou execute: python deploy_wasm.py  (usa o binário pré-compilado)
 */

typedef float f32;
typedef int   i32;
typedef unsigned int u32;

static f32 clampf(f32 v, f32 lo, f32 hi) { return v < lo ? lo : (v > hi ? hi : v); }

/*
 * Struct de partícula (8 floats = 32 bytes):
 *   [0]x [1]y [2]vx [3]vy [4]vida [5]decay [6]tam [7]flags
 *   flags: bit0=ativo, bit1=tem_gravidade, bit2=tem_drift
 */
__attribute__((export_name("update_particles")))
void update_particles(f32* mem, i32 count, f32 dt) {
    for (i32 i = 0; i < count; i++) {
        f32* p = mem + i * 8;
        u32 flags = (u32)p[7];
        if (!(flags & 1u)) continue;

        p[0] += p[2] * dt;
        p[1] += p[3] * dt;
        if (flags & 2u) p[3] += 0.05f * dt;  /* gravidade */
        if (flags & 4u) p[2] *= (1.0f - 0.02f * dt); /* drift */

        p[4] -= p[5] * dt;
        p[6] *= (1.0f - 0.005f * dt);
        if (p[6] < 0.3f) p[6] = 0.3f;
        if (p[4] <= 0.0f) { p[4] = 0.0f; p[7] = (f32)(flags & ~1u); }
    }
}

__attribute__((export_name("lerp_positions")))
void lerp_positions(const f32* src, const f32* dst, f32* out, i32 n, f32 t) {
    t = clampf(t, 0.0f, 1.0f);
    f32 inv_t = 1.0f - t;
    for (i32 i = 0; i < n * 2; i++)
        out[i] = src[i] * inv_t + dst[i] * t;
}

__attribute__((export_name("check_rect_overlap")))
i32 check_rect_overlap(f32 ax,f32 ay,f32 aw,f32 ah, f32 bx,f32 by,f32 bw,f32 bh) {
    return (ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by) ? 1 : 0;
}

__attribute__((export_name("check_point_in_rect")))
i32 check_point_in_rect(f32 px,f32 py, f32 rx,f32 ry,f32 rw,f32 rh) {
    return (px >= rx && px <= rx+rw && py >= ry && py <= ry+rh) ? 1 : 0;
}

/* snow_update: [x, y, vel, drift, size] × count */
__attribute__((export_name("snow_update")))
void snow_update(f32* mem, i32 count, f32 speed_mult, f32 w, f32 h) {
    for (i32 i = 0; i < count; i++) {
        f32* p = mem + i * 5;
        p[1] += p[2] * speed_mult;
        p[0] += p[3];
        if (p[1] > h)    p[1] = -5.0f;
        if (p[0] > w)    p[0] = 0.0f;
        if (p[0] < 0.0f) p[0] = w;
    }
}
