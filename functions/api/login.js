// ============================================================
// POST /api/login  — body: { password: "..." }
// Kalau password cocok dengan secret AUTH_PASSWORD, keluarkan session token
// (berlaku 12 jam). Password TIDAK PERNAH disimpan di kode/HTML — cuma ada
// di server sebagai environment secret Cloudflare.
// ============================================================
import { createSessionToken, corsHeaders } from '../_lib/auth.js';

export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
    try {
        const body = await request.json();
        const password = body.password || '';

        if (!env.AUTH_PASSWORD) {
            return json({ error: 'Server belum dikonfigurasi (AUTH_PASSWORD belum di-set).' }, 500);
        }

        if (password !== env.AUTH_PASSWORD) {
            // Sengaja delay dikit biar nggak gampang di-brute-force
            await new Promise(r => setTimeout(r, 400));
            return json({ error: 'Password salah.' }, 401);
        }

        const token = await createSessionToken(env.SESSION_SECRET);
        return json({ token });
    } catch (e) {
        return json({ error: 'Gagal memproses login: ' + e.message }, 500);
    }
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}
