// ============================================================
// GET  /api/data  (header: Authorization: Bearer <token>) -> ambil semua data
// POST /api/data  (header: Authorization: Bearer <token>) -> simpan/replace semua data
// Full-replace sync: tiap kali sync, seluruh tabel ditimpa dengan data yang dikirim
// dari browser. Sederhana & aman dari bug partial-update, cukup cepat untuk data
// sekelas UMKM (ribuan order pun masih ringan buat D1).
// ============================================================
import { requireAuth, corsHeaders } from '../_lib/auth.js';

export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
    const authFail = await requireAuth(request, env);
    if (authFail) return withCors(authFail);

    try {
        const db = env.DB;

        const orderRows = await db.prepare('SELECT * FROM orders').all();
        let orders = {};
        for (const r of orderRows.results) {
            orders[r.noPesanan] = {
                noPesanan: r.noPesanan,
                platform: r.platform,
                namaToko: r.namaToko || '',
                status: r.status,
                isCancelled: !!r.isCancelled,
                hasReturnSignal: !!r.hasReturnSignal,
                resi: r.resi || '',
                ekspedisi: r.ekspedisi || '',
                timestamp: r.timestamp,
                keterangan: r.keterangan || '',
                omset: r.omset === '' || r.omset === null ? '' : Number(r.omset),
                gmv: r.gmv || 0,
                items: r.itemsJson ? JSON.parse(r.itemsJson) : []
            };
        }

        const adRows = await db.prepare('SELECT * FROM adspend').all();
        let adSpend = {};
        for (const r of adRows.results) adSpend[r.key] = { platform: r.platform, amount: r.amount, timestamp: r.timestamp };

        const unclassRows = await db.prepare('SELECT * FROM unclassified').all();
        let unclassified = {};
        for (const r of unclassRows.results) unclassified[r.key] = { description: r.description, amount: r.amount, timestamp: r.timestamp };

        const hppRows = await db.prepare('SELECT * FROM hpp_prices').all();
        let hppMap = {};
        for (const r of hppRows.results) {
            if (!hppMap[r.versionId]) hppMap[r.versionId] = { id: r.versionId, label: r.label, effectiveFrom: r.effectiveFrom, prices: {} };
            hppMap[r.versionId].prices[r.sku] = r.harga;
        }
        let hppVersions = Object.values(hppMap);

        const skuOvRows = await db.prepare('SELECT * FROM sku_override').all();
        let skuOverrides = {};
        for (const r of skuOvRows.results) skuOverrides[r.key] = r.sku;

        const returRows = await db.prepare('SELECT * FROM retur_confirm').all();
        let returConfirmations = {};
        for (const r of returRows.results) returConfirmations[r.noPesanan] = !!r.confirmed;

        // Pencairan per-order (tabel 'pencairan'). Dibungkus try/catch: kalau tabelnya belum dibuat
        // di D1, aplikasi tetap jalan seperti biasa (cuma pencairan-duluan belum bisa tersimpan).
        let pencairan = {};
        try {
            const pRows = await db.prepare('SELECT * FROM pencairan').all();
            for (const r of pRows.results) pencairan[r.noPesanan] = { omset: r.omset, date: r.tanggal || '' };
        } catch (e) { /* tabel pencairan belum ada */ }

        return withCors(json({ orders, adSpend, unclassified, pencairan, hppVersions, skuOverrides, returConfirmations }));
    } catch (e) {
        return withCors(json({ error: 'Gagal mengambil data: ' + e.message }, 500));
    }
}

export async function onRequestPost({ request, env }) {
    const authFail = await requireAuth(request, env);
    if (authFail) return withCors(authFail);

    try {
        const data = await request.json();
        const db = env.DB;
        const statements = [];

        // --- Orders (full replace) ---
        statements.push(db.prepare('DELETE FROM orders'));
        for (const o of Object.values(data.orders || {})) {
            statements.push(db.prepare(
                `INSERT INTO orders (noPesanan, platform, namaToko, status, isCancelled, hasReturnSignal, resi, ekspedisi, timestamp, keterangan, omset, gmv, itemsJson)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
            ).bind(
                o.noPesanan, o.platform, o.namaToko || '', o.status,
                o.isCancelled ? 1 : 0, o.hasReturnSignal ? 1 : 0,
                o.resi || '', o.ekspedisi || '', o.timestamp,
                o.keterangan || '', String(o.omset), o.gmv || 0,
                JSON.stringify(o.items || [])
            ));
        }

        // --- AdSpend ---
        statements.push(db.prepare('DELETE FROM adspend'));
        for (const key of Object.keys(data.adSpend || {})) {
            const e = data.adSpend[key];
            statements.push(db.prepare('INSERT INTO adspend (key, platform, amount, timestamp) VALUES (?,?,?,?)')
                .bind(key, e.platform, e.amount, e.timestamp));
        }

        // --- Unclassified ---
        statements.push(db.prepare('DELETE FROM unclassified'));
        for (const key of Object.keys(data.unclassified || {})) {
            const e = data.unclassified[key];
            statements.push(db.prepare('INSERT INTO unclassified (key, description, amount, timestamp) VALUES (?,?,?,?)')
                .bind(key, e.description, e.amount, e.timestamp));
        }

        // --- HPP (flatten versi -> per SKU) ---
        statements.push(db.prepare('DELETE FROM hpp_prices'));
        for (const v of (data.hppVersions || [])) {
            for (const sku of Object.keys(v.prices || {})) {
                statements.push(db.prepare('INSERT INTO hpp_prices (versionId, label, effectiveFrom, sku, harga) VALUES (?,?,?,?,?)')
                    .bind(v.id, v.label, v.effectiveFrom, sku, v.prices[sku]));
            }
        }

        // --- SKU Override ---
        statements.push(db.prepare('DELETE FROM sku_override'));
        for (const key of Object.keys(data.skuOverrides || {})) {
            statements.push(db.prepare('INSERT INTO sku_override (key, sku) VALUES (?,?)').bind(key, data.skuOverrides[key]));
        }

        // --- Retur Confirm ---
        statements.push(db.prepare('DELETE FROM retur_confirm'));
        for (const key of Object.keys(data.returConfirmations || {})) {
            statements.push(db.prepare('INSERT INTO retur_confirm (noPesanan, confirmed) VALUES (?,?)')
                .bind(key, data.returConfirmations[key] ? 1 : 0));
        }

        await db.batch(statements);

        // --- Pencairan per-order: batch TERPISAH + try/catch, supaya kalau tabel 'pencairan' belum
        // dibuat di D1, sinkron data utama di atas tetap berhasil. Cuma ditimpa kalau browser
        // memang mengirim field 'pencairan' (browser versi lama nggak kirim -> data tersimpan aman).
        let pencairanSaved = null;
        if (data.pencairan && typeof data.pencairan === 'object') {
            try {
                const pStatements = [db.prepare('DELETE FROM pencairan')];
                for (const key of Object.keys(data.pencairan)) {
                    const p = data.pencairan[key];
                    if (!p || typeof p.omset !== 'number') continue;
                    pStatements.push(db.prepare('INSERT INTO pencairan (noPesanan, omset, tanggal) VALUES (?,?,?)')
                        .bind(key, p.omset, p.date || ''));
                }
                await db.batch(pStatements);
                pencairanSaved = true;
            } catch (e) {
                pencairanSaved = false;
            }
        }

        return withCors(json({ success: true, ordersCount: Object.keys(data.orders || {}).length, pencairanSaved }));
    } catch (e) {
        return withCors(json({ error: 'Gagal menyimpan data: ' + e.message }, 500));
    }
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function withCors(response) {
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
}
