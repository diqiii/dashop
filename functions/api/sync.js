// ============================================================
// POST /api/sync (header: Authorization: Bearer <token>)
// Sinkronisasi parsial (upsert) dari ekstensi browser.
// Hanya menambah atau memperbarui baris yang dikirim tanpa menghapus data lama.
// ============================================================
import { requireAuth, corsHeaders } from '../_lib/auth.js';

const CREATE_AD_CAMPAIGNS_SQL = `
CREATE TABLE IF NOT EXISTS ad_campaigns (
    campaignId TEXT,
    periodKey TEXT,
    platform TEXT DEFAULT 'Shopee',
    namaKampanye TEXT,
    jenisIklan TEXT,
    status TEXT,
    itemId TEXT DEFAULT '',
    sku TEXT DEFAULT '',
    biaya REAL DEFAULT 0,
    omzetIklan REAL DEFAULT 0,
    roas REAL DEFAULT 0,
    acos REAL DEFAULT 0,
    impresi INTEGER DEFAULT 0,
    klik INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    konversi INTEGER DEFAULT 0,
    itemTerjual INTEGER DEFAULT 0,
    dailyBudget REAL DEFAULT 0,
    startTime INTEGER DEFAULT 0,
    endTime INTEGER DEFAULT 0,
    updatedAt INTEGER DEFAULT 0,
    PRIMARY KEY (campaignId, periodKey)
)`;

export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
    const authFail = await requireAuth(request, env);
    if (authFail) return withCors(authFail);

    try {
        const body = await request.json();
        const db = env.DB;

        let ordersSaved = 0;
        let pencairanSaved = 0;
        let adCampaignsSaved = 0;
        let hppSaved = false;

        // 1. Upsert Orders (parsial, tidak menghapus pesanan lama)
        if (Array.isArray(body.orders) && body.orders.length > 0) {
            const stmts = [];
            for (const o of body.orders) {
                if (!o || !o.noPesanan) continue;
                const noPesanan = String(o.noPesanan).trim();
                const itemsStr = JSON.stringify(Array.isArray(o.items) ? o.items : []);
                const omsetVal = (o.omset !== undefined && o.omset !== null && o.omset !== '')
                    ? String(o.omset)
                    : '';

                stmts.push(db.prepare(
                    `INSERT INTO orders (noPesanan, platform, namaToko, status, isCancelled, hasReturnSignal, resi, ekspedisi, timestamp, keterangan, omset, gmv, itemsJson)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                     ON CONFLICT(noPesanan) DO UPDATE SET
                        platform = COALESCE(NULLIF(excluded.platform, ''), orders.platform),
                        namaToko = COALESCE(NULLIF(excluded.namaToko, ''), orders.namaToko),
                        status = COALESCE(NULLIF(excluded.status, ''), orders.status),
                        isCancelled = excluded.isCancelled,
                        hasReturnSignal = CASE WHEN excluded.hasReturnSignal = 1 THEN 1 ELSE orders.hasReturnSignal END,
                        resi = COALESCE(NULLIF(excluded.resi, ''), orders.resi),
                        ekspedisi = COALESCE(NULLIF(excluded.ekspedisi, ''), orders.ekspedisi),
                        timestamp = CASE WHEN excluded.timestamp > 0 THEN excluded.timestamp ELSE orders.timestamp END,
                        keterangan = COALESCE(NULLIF(excluded.keterangan, ''), orders.keterangan),
                        omset = CASE WHEN excluded.omset != '' THEN excluded.omset ELSE orders.omset END,
                        gmv = CASE WHEN excluded.gmv > 0 THEN excluded.gmv ELSE orders.gmv END,
                        itemsJson = CASE WHEN excluded.itemsJson != '[]' AND excluded.itemsJson != '' THEN excluded.itemsJson ELSE orders.itemsJson END`
                ).bind(
                    noPesanan,
                    o.platform || 'Shopee',
                    o.namaToko || '',
                    o.status || '',
                    o.isCancelled ? 1 : 0,
                    o.hasReturnSignal ? 1 : 0,
                    o.resi || '',
                    o.ekspedisi || '',
                    Number(o.timestamp) || 0,
                    o.keterangan || '',
                    omsetVal,
                    Number(o.gmv) || 0,
                    itemsStr
                ));

                // Jika pencairan untuk pesanan ini sudah masuk lebih dulu, langsung sinkronkan ke orders.omset
                stmts.push(db.prepare(
                    `UPDATE orders
                     SET omset = COALESCE((SELECT CAST(omset AS TEXT) FROM pencairan WHERE pencairan.noPesanan = orders.noPesanan), orders.omset)
                     WHERE noPesanan = ? AND (omset = '' OR omset IS NULL)`
                ).bind(noPesanan));

                ordersSaved++;
            }
            if (stmts.length > 0) await db.batch(stmts);
        }

        // 2. Upsert Pencairan (parsial, sekaligus isi omset pada pesanan yang sudah ada)
        if (Array.isArray(body.pencairan) && body.pencairan.length > 0) {
            const pStmts = [];
            for (const p of body.pencairan) {
                if (!p || !p.noPesanan || typeof p.omset !== 'number') continue;
                const noPesanan = String(p.noPesanan).trim();
                pStmts.push(db.prepare(
                    `INSERT INTO pencairan (noPesanan, omset, tanggal) VALUES (?,?,?)
                     ON CONFLICT(noPesanan) DO UPDATE SET
                        omset = excluded.omset,
                        tanggal = COALESCE(NULLIF(excluded.tanggal, ''), pencairan.tanggal)`
                ).bind(noPesanan, p.omset, p.date || ''));

                pStmts.push(db.prepare(
                    `UPDATE orders SET omset = ? WHERE noPesanan = ?`
                ).bind(String(p.omset), noPesanan));

                pencairanSaved++;
            }
            if (pStmts.length > 0) await db.batch(pStmts);
        }

        // 3. Upsert Performa Kampanye Iklan (tabel ad_campaigns)
        if (Array.isArray(body.adCampaigns) && body.adCampaigns.length > 0) {
            const runAdUpsert = async () => {
                const aStmts = [];
                for (const c of body.adCampaigns) {
                    if (!c || !c.campaignId || !c.periodKey) continue;
                    aStmts.push(db.prepare(
                        `INSERT INTO ad_campaigns (
                            campaignId, periodKey, platform, namaKampanye, jenisIklan, status,
                            itemId, sku, biaya, omzetIklan, roas, acos, impresi, klik, ctr, cpc,
                            konversi, itemTerjual, dailyBudget, startTime, endTime, updatedAt
                         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(campaignId, periodKey) DO UPDATE SET
                            namaKampanye = excluded.namaKampanye,
                            jenisIklan = excluded.jenisIklan,
                            status = excluded.status,
                            itemId = COALESCE(NULLIF(excluded.itemId, ''), ad_campaigns.itemId),
                            sku = COALESCE(NULLIF(excluded.sku, ''), ad_campaigns.sku),
                            biaya = excluded.biaya,
                            omzetIklan = excluded.omzetIklan,
                            roas = excluded.roas,
                            acos = excluded.acos,
                            impresi = excluded.impresi,
                            klik = excluded.klik,
                            ctr = excluded.ctr,
                            cpc = excluded.cpc,
                            konversi = excluded.konversi,
                            itemTerjual = excluded.itemTerjual,
                            dailyBudget = excluded.dailyBudget,
                            startTime = excluded.startTime,
                            endTime = excluded.endTime,
                            updatedAt = excluded.updatedAt`
                    ).bind(
                        String(c.campaignId),
                        String(c.periodKey),
                        c.platform || 'Shopee',
                        c.namaKampanye || '',
                        c.jenisIklan || '',
                        c.status || '',
                        String(c.itemId || ''),
                        String(c.sku || ''),
                        Number(c.biaya) || 0,
                        Number(c.omzetIklan) || 0,
                        Number(c.roas) || 0,
                        Number(c.acos) || 0,
                        Number(c.impresi) || 0,
                        Number(c.klik) || 0,
                        Number(c.ctr) || 0,
                        Number(c.cpc) || 0,
                        Number(c.konversi) || 0,
                        Number(c.itemTerjual) || 0,
                        Number(c.dailyBudget) || 0,
                        Number(c.startTime) || 0,
                        Number(c.endTime) || 0,
                        Number(c.updatedAt) || Date.now()
                    ));
                    adCampaignsSaved++;
                }
                if (aStmts.length > 0) await db.batch(aStmts);
            };

            try {
                await runAdUpsert();
            } catch (err) {
                // Otomatis buat tabel jika user belum sempat menjalankan schema.sql terbaru di D1
                await db.prepare(CREATE_AD_CAMPAIGNS_SQL).run();
                adCampaignsSaved = 0;
                await runAdUpsert();
            }
        }

        // 4. Input cepat HPP per SKU dari popup tag iklan
        if (body.hppQuickUpdate && body.hppQuickUpdate.sku && Number(body.hppQuickUpdate.harga) >= 0) {
            const skuClean = String(body.hppQuickUpdate.sku).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const harga = Number(body.hppQuickUpdate.harga);
            if (skuClean) {
                const latest = await db.prepare(
                    `SELECT versionId, label, effectiveFrom FROM hpp_prices ORDER BY effectiveFrom DESC LIMIT 1`
                ).first();

                const versionId = latest?.versionId || 'v_ext_init';
                const label = latest?.label || 'Input Ekstensi';
                const effectiveFrom = latest?.effectiveFrom ?? 0;

                await db.prepare(
                    `INSERT INTO hpp_prices (versionId, label, effectiveFrom, sku, harga)
                     VALUES (?,?,?,?,?)
                     ON CONFLICT(versionId, sku) DO UPDATE SET harga = excluded.harga`
                ).bind(versionId, label, effectiveFrom, skuClean, harga).run();
                hppSaved = true;
            }
        }

        return withCors(json({
            success: true,
            ordersSaved,
            pencairanSaved,
            adCampaignsSaved,
            hppSaved
        }));
    } catch (e) {
        return withCors(json({ error: 'Gagal sinkronisasi parsial: ' + e.message }, 500));
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
