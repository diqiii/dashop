# Panduan Setup — Deploy ke Cloudflare Pages + Database D1

Ikuti urutan ini dari atas ke bawah. Sekali setup, selanjutnya cukup `git push` untuk update.

---

## 1. Push ke GitHub

Extract zip, lalu dari dalam foldernya:

```bash
git init
git add .
git commit -m "Dashboard penjualan + cloud database"
git branch -M main
git remote add origin https://github.com/diqiii/NAMA-REPO.git
git push -u origin main
```

Struktur foldernya harus seperti ini (jangan diubah, Cloudflare mengenali folder `functions/` secara otomatis):

```
index.html
modal-kalkulator.html
schema.sql
functions/
  _lib/auth.js
  api/login.js
  api/data.js
```

---

## 2. Buat Database D1

Install wrangler dulu kalau belum ada:

```bash
npm install -g wrangler
wrangler login
```

Buat database:

```bash
wrangler d1 create dashboard-toko
```

Perintah di atas akan menampilkan **database ID** — simpan/catat, dipakai di langkah 4.

Lalu buat semua tabelnya:

```bash
wrangler d1 execute dashboard-toko --remote --file=schema.sql
```

---

## 3. Buat Project Cloudflare Pages

1. Buka https://dash.cloudflare.com → **Workers & Pages** → **Create** → tab **Pages** → **Connect to Git**
2. Pilih repo GitHub yang tadi kamu push
3. Build settings — **kosongkan semua**:
   - Framework preset: `None`
   - Build command: (kosong)
   - Build output directory: `/`
4. Klik **Save and Deploy**

Setelah selesai kamu dapat URL, misal `dashboard-toko.pages.dev`.

---

## 4. Hubungkan Database ke Project

Di halaman project Pages kamu: **Settings** → **Bindings** (atau **Functions** → **D1 database bindings**) → **Add binding**:

| Field | Isi |
|---|---|
| Variable name | `DB` |
| D1 database | pilih `dashboard-toko` |

⚠️ Variable name **harus persis `DB`** (huruf besar), karena itu yang dipanggil di kode.

---

## 5. Set Password & Secret

Masih di **Settings** → **Environment variables** (pilih **Production**), tambahkan 2 variabel sebagai **Secret** (klik "Encrypt", bukan plaintext):

| Nama | Isi |
|---|---|
| `AUTH_PASSWORD` | password yang kamu mau pakai buat login (bebas, bikin yang kuat) |
| `SESSION_SECRET` | string acak panjang, bebas — dipakai buat tanda tangan token. Contoh generate: jalankan `openssl rand -base64 32` di terminal |

Setelah menambah binding & environment variables, **klik Retry deployment / Redeploy** supaya perubahan aktif.

---

## 6. Selesai — Cara Pakai

1. Buka `https://dashboard-toko.pages.dev`
2. Muncul layar login → masukkan `AUTH_PASSWORD` yang kamu set tadi
3. Setelah masuk, pakai seperti biasa. Semua data (pesanan, HPP, checklist retur, koreksi SKU) otomatis tersimpan ke cloud
4. Buka dari HP/laptop/device lain → login pakai password yang sama → data langsung sama

Indikator **☁️ Tersinkron** di pojok kanan atas menunjukkan status penyimpanan cloud (berubah jadi 🔄 saat menyimpan, ⚠️ kalau koneksi bermasalah).

---

## Catatan Penting

**Data lama di Vercel tidak ikut pindah otomatis.** localStorage terikat per-domain, jadi data di `xxx.vercel.app` tidak terbawa ke `xxx.pages.dev`. Kamu perlu upload ulang file pesanan & pencairan sekali di domain baru — setelah itu tersimpan permanen di cloud.

**Sesi login berlaku 12 jam**, setelah itu diminta login lagi. Ini disengaja untuk keamanan.

**Password tidak pernah ada di kode HTML.** Yang tersimpan di browser cuma token sementara hasil login, dan token itu tidak bisa dipalsukan tanpa `SESSION_SECRET` yang ada di server. Ini alasan pendekatan ini lebih aman daripada rencana Google Apps Script sebelumnya (yang mengharuskan token ditempel di kode).

**Cara update aplikasi ke depannya:** cukup `git push`, Cloudflare otomatis re-deploy. Data di D1 tidak terpengaruh oleh deploy ulang.

**Kalau lupa set `cloudApiUrl`:** secara default aplikasi memakai URL domain-nya sendiri, jadi biasanya tidak perlu diatur manual. Pengaturan manual lewat Console (F12) hanya diperlukan kalau frontend dan API berada di domain berbeda.
