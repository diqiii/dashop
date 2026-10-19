-- ============================================================
-- Skema Database D1 — Dashboard Penjualan & Analitik Toko (UPDATED)
-- ============================================================
-- Perubahan: Tambah tabel 'settlements' untuk pencairan per-order
-- Ini memungkinkan upload order & file pencairan TERPISAH waktu & urutan apapun
-- 
-- Cara pakai: jalankan file ini SEKALI lewat wrangler untuk bikin/update tabel:
-- wrangler d1 execute NAMA_DATABASE --remote --file=schema-updated.sql
-- ============================================================

-- TABEL ORDERS (tidak berubah)
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
  omset TEXT,
  gmv REAL DEFAULT 0,
  itemsJson TEXT
);

-- TABEL SETTLEMENTS (BARU) — untuk menyimpan pencairan per-order
-- Ini table TAMBAHAN, bukan replace. Satu order bisa punya multiple settlements
-- (misal order 1 dapat 2 kali pencairan kalau ada refund/adjustment).
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY, -- format: noPesanan_timestamp_uniqueId
  noPesanan TEXT,
  platform TEXT,
  amount REAL,
  transactionType TEXT, -- "order_revenue", "refund", "penalty", "adjustment"
  transactionDate INTEGER,
  description TEXT,
  FOREIGN KEY (noPesanan) REFERENCES orders(noPesanan)
);

-- TABEL ADSPEND (tidak berubah)
CREATE TABLE IF NOT EXISTS adspend (
  key TEXT PRIMARY KEY,
  platform TEXT,
  amount REAL,
  timestamp INTEGER
);

-- TABEL UNCLASSIFIED (tidak berubah)
CREATE TABLE IF NOT EXISTS unclassified (
  key TEXT PRIMARY KEY,
  description TEXT,
  amount REAL,
  timestamp INTEGER
);

-- TABEL HPP_PRICES (tidak berubah)
CREATE TABLE IF NOT EXISTS hpp_prices (
  versionId TEXT,
  label TEXT,
  effectiveFrom INTEGER,
  sku TEXT,
  harga REAL,
  PRIMARY KEY (versionId, sku)
);

-- TABEL SKU_OVERRIDE (tidak berubah)
CREATE TABLE IF NOT EXISTS sku_override (
  key TEXT PRIMARY KEY,
  sku TEXT
);

-- TABEL RETUR_CONFIRM (tidak berubah)
CREATE TABLE IF NOT EXISTS retur_confirm (
  noPesanan TEXT PRIMARY KEY,
  confirmed INTEGER DEFAULT 0
);

-- INDEXES untuk performa query
CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp);
CREATE INDEX IF NOT EXISTS idx_adspend_timestamp ON adspend(timestamp);
CREATE INDEX IF NOT EXISTS idx_settlements_noPesanan ON settlements(noPesanan);
CREATE INDEX IF NOT EXISTS idx_settlements_platform ON settlements(platform);
CREATE INDEX IF NOT EXISTS idx_settlements_date ON settlements(transactionDate);
