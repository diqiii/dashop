-- ============================================================
-- Skema Database D1 — Dashboard Penjualan & Analitik Toko
-- ============================================================
-- Cara pakai: jalankan file ini SEKALI lewat wrangler untuk bikin semua tabel:
--   wrangler d1 execute NAMA_DATABASE --remote --file=schema.sql
-- ATAU tanpa terminal: Cloudflare dashboard -> D1 -> pilih database -> tab "Console" ->
-- paste isi file ini -> Execute. Aman dijalankan ulang (semua pakai IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
    noPesanan TEXT PRIMARY KEY,
    platform TEXT,
    namaToko TEXT,
    status TEXT,
    isCancelled INTEGER DEFAULT 0,
    hasReturnSignal INTEGER DEFAULT 0,
    resi TEXT,
    ekspedisi TEXT,
    timestamp INTEGER,
    keterangan TEXT,
    omset TEXT,          -- disimpan sebagai TEXT karena bisa berupa "" (belum cair) atau angka
    gmv REAL DEFAULT 0,
    itemsJson TEXT        -- array item [{sku, namaProduk, jumlah}] disimpan sebagai JSON string
);

CREATE TABLE IF NOT EXISTS adspend (
    key TEXT PRIMARY KEY,  -- format: platform_timestamp_amount (dedup key)
    platform TEXT,
    amount REAL,
    timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS unclassified (
    key TEXT PRIMARY KEY,  -- format: description_timestamp_amount (dedup key)
    description TEXT,
    amount REAL,
    timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS hpp_prices (
    versionId TEXT,
    label TEXT,
    effectiveFrom INTEGER,
    sku TEXT,
    harga REAL,
    PRIMARY KEY (versionId, sku)
);

CREATE TABLE IF NOT EXISTS sku_override (
    key TEXT PRIMARY KEY,  -- format: noPesanan||namaProduk
    sku TEXT
);

CREATE TABLE IF NOT EXISTS retur_confirm (
    noPesanan TEXT PRIMARY KEY,
    confirmed INTEGER DEFAULT 0
);

-- Pencairan per-order dari file pencairan (Shopee/TikTok), disimpan TERPISAH dari pesanan supaya
-- file pencairan boleh diupload sebelum file pesanannya ada. Satu baris per No. Pesanan.
CREATE TABLE IF NOT EXISTS pencairan (
    noPesanan TEXT PRIMARY KEY,
    omset REAL,           -- total pencairan untuk order ini
    tanggal TEXT          -- tanggal transaksi pencairan (teks apa adanya dari file)
);

CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp);
CREATE INDEX IF NOT EXISTS idx_adspend_timestamp ON adspend(timestamp);
