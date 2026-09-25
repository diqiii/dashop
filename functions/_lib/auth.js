// ============================================================
// Helper autentikasi — dipakai bareng oleh semua endpoint di functions/api/
// File berawalan underscore TIDAK dianggap route oleh Cloudflare Pages Functions,
// jadi aman dipakai sebagai modul biasa (bukan endpoint publik).
// ============================================================

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // sesi login berlaku 12 jam

function toBase64Url(bytes) {
    let str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    let bin = atob(str);
    let bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function hmacSign(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return toBase64Url(sig);
}

// Buat session token baru: {exp}.{signature}
export async function createSessionToken(secret) {
    const payload = JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS });
    const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
    const sig = await hmacSign(secret, payloadB64);
    return `${payloadB64}.${sig}`;
}

// Verifikasi session token dari header Authorization: Bearer <token>
export async function verifySessionToken(token, secret) {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sig] = parts;
    const expectedSig = await hmacSign(secret, payloadB64);
    if (sig !== expectedSig) return false; // signature nggak cocok = token palsu/dimodifikasi
    try {
        const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
        return payload.exp > Date.now(); // masih belum expired
    } catch (e) {
        return false;
    }
}

// Dipanggil di awal tiap endpoint yang butuh login. Return Response kalau ditolak, null kalau lolos.
export async function requireAuth(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const valid = await verifySessionToken(token, env.SESSION_SECRET);
    if (!valid) {
        return new Response(JSON.stringify({ error: 'Sesi tidak valid atau sudah habis. Silakan login ulang.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return null;
}

export function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
}
