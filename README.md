# Lapangin

Aplikasi booking lapangan olahraga + komunitas untuk pemain kasual di Indonesia.
Mobile-first web app berbentuk Android, jalan tanpa server — seluruh backend
disimulasikan MSW.

```bash
npm install
npm run dev
```

Buka URL yang dicetak Vite, lalu tekan **Masuk dengan akun demo**.

---

## Perintah

| Perintah             | Guna                                               |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Dev server (MSW aktif otomatis)                    |
| `npm run build`      | Typecheck + build produksi                         |
| `npm run verify`     | `lint` + `typecheck` + `test` — gerbang sebelum PR |
| `npm test`           | Vitest sekali jalan                                |
| `npm run test:watch` | Vitest mode tonton                                 |
| `npm run format`     | Prettier                                           |

---

## Arsitektur

Empat lapisan, dari dalam ke luar. Aturannya satu arah: lapisan luar boleh
mengimpor yang di dalam, tidak sebaliknya.

```
src/types      ── model domain, tanpa dependensi apa pun
   ▲
src/lib        ── aturan bisnis murni (harga, poin, split bill, slot)
   ▲              fungsi biasa, tanpa React, di sinilah tes unit menggigit
src/mocks      ── backend tiruan: handler MSW + "database" in-memory
src/hooks      ── TanStack Query membungkus HTTP; Zustand memegang state alur
src/store
   ▲
src/routes     ── satu berkas per layar
src/components ── primitif UI + kartu domain + kerangka layar
```

**Kenapa aturan bisnis dipisah dari komponen.** Perhitungan harga, pembulatan
split bill, batas penukaran poin, dan validasi slot bersambung semuanya hidup
di `src/lib` sebagai fungsi murni. Mereka bisa diuji tanpa merender apa pun,
dan komponen tinggal memanggil — jadi tidak ada aturan yang diam-diam
tergandakan di dua layar dengan hasil berbeda.

### Peta folder

```
src/
├─ types/index.ts          Sport, Venue, Court, Slot, Booking, SplitBill,
│                          OpenMatch, Team, Tournament, Review, Notification, User
├─ lib/
│  ├─ pricing.ts           harga dari slot terpilih (bukan tarif × jam)
│  ├─ points.ts            1 pt / Rp1.000; tukar kelipatan 100; batas 30%
│  ├─ split.ts             bagi rata, sisa pembulatan ke host
│  ├─ slots.ts             pilihan harus bersambung; deteksi bentrok berulang
│  ├─ dates.ts             format Indonesia (date-fns locale id)
│  ├─ money.ts             Rp145.000 / Rp65rb (Intl id-ID)
│  ├─ api.ts               pembungkus fetch + ApiError bertipe
│  └─ storage.ts           localStorage bernamespace `lapangin:`
├─ mocks/
│  ├─ seed.ts              venue Bandung, nama Indonesia, harga rupiah
│  ├─ db.ts                ketersediaan slot deterministik + booking in-memory
│  ├─ handlers.ts          seluruh endpoint /api/*
│  └─ browser.ts server.ts transport MSW untuk app dan untuk tes
├─ store/
│  ├─ auth.ts              user + token, tersimpan di localStorage
│  └─ draft.ts             state machine alur booking
├─ hooks/
│  ├─ queries.ts           seluruh hook TanStack Query
│  └─ useSearchFilters.ts  filter pencarian yang hidup di URL
├─ components/
│  ├─ ui/                  Button, Icon, primitives, states (skeleton/empty/error)
│  ├─ layout/              AndroidFrame, Screen, BottomNav
│  └─ domain/              kartu venue/open match/turnamen/tim, ikon cabang
├─ routes/                 18 layar
└─ styles/
   ├─ tokens.css           satu-satunya tempat nilai warna mentah boleh ada
   └─ global.css           reset + utilitas
```

### Rute

| Rute                  | Layar                                            | Bottom nav |
| --------------------- | ------------------------------------------------ | ---------- |
| `/login`              | 01 Masuk / onboarding                            | —          |
| `/`                   | 02 Home (tab Venue) · 13 Home v2 (tab Komunitas) | ✓          |
| `/search`             | 03 Cari & filter                                 | —          |
| `/venue/:id`          | 04 Detail venue                                  | —          |
| `/venue/:id/schedule` | 05 Pilih lapangan & jam                          | —          |
| `/booking/summary`    | 06 Ringkasan + split bill                        | —          |
| `/booking/payment`    | 07 Pembayaran + countdown                        | —          |
| `/booking/:id/ticket` | 08 E-tiket QR                                    | —          |
| `/bookings`           | 09 Booking saya                                  | ✓          |
| `/profile`            | 10 Profil & poin                                 | ✓          |
| `/venue/:id/reviews`  | 11 Ulasan                                        | —          |
| `/notifications`      | 12 Notifikasi                                    | —          |
| `/match`              | 14 Cari lawan · 16 daftar tim                    | ✓          |
| `/tournaments`        | 15 Turnamen                                      | —          |
| `/team/:id`           | 16 Tim & komunitas                               | —          |
| `/match/:id`          | 17 Detail open match                             | —          |
| `/chat/:id`           | 18 Obrolan grup + kartu split bill               | —          |

Layar 02 dan 13 adalah dua wajah home yang sama-sama diminta brief, jadi
keduanya jadi tab di rute `/` alih-alih dua URL yang bersaing.

---

## Perilaku yang benar-benar berjalan

**Slot picker.** Strip 14 hari, tab lapangan, grid per jam. Pilihan majemuk
wajib bersambung: slot yang tidak menempel di ujung blok ditolak dengan alasan,
dan slot di tengah tidak bisa dilepas supaya blok tidak terbelah. Harga dihitung
ulang tiap perubahan — prime time 18.00–21.00 bertarif 20% lebih tinggi, dan
lapangan premium punya tarif sendiri, jadi total datang dari penjumlahan slot,
bukan `tarif × jam`.

**Jadwal berulang.** Toggle "Ulangi tiap Jumat, 4 minggu" memvalidasi setiap
slot di minggu-minggu berikutnya ke server dan melaporkan minggu mana yang
bentrok. Selama masih ada bentrokan, tombol Lanjut terkunci.

**Pencarian.** Query di-debounce 350 ms; query dan seluruh filter tersimpan di
URL search params, jadi hasil pencarian bisa dibagikan lewat link dan tombol
back/forward peramban mengembalikan filter sebelumnya.

**Alur booking sebagai state machine.**

```
draft ──goToSummary──▶ summary ──attachBooking──▶ awaitingPayment ──confirm──▶ confirmed
  ▲                       │                            │
  └───ubah pilihan────────┴──────hold habis────────────┘
```

Menyentuh pilihan slot menjatuhkan stage kembali ke `draft` dan melepas booking
yang sudah dibuat di server — draft basi tidak akan pernah bisa dibayar.
Penjaganya `canPay()` di store, bukan sekadar tombol yang di-disable.

**Countdown pembayaran.** Hold 10 menit, sumber kebenarannya deadline dari
server — refresh halaman tidak mereset waktu. Begitu habis, slot dilepas dan
layar menjelaskan apa yang terjadi alih-alih melempar user keluar.

**Split bill.** Tambah/hapus peserta, nominal per orang dihitung ulang tiap
kali. Rupiah tidak punya pecahan sen, jadi pembagian dibulatkan ke bawah dan
**sisanya ditanggung host** — supaya angka yang ditagih ke tiap peserta selalu
sama persis. Progres lunas tampil di Booking saya dan di kartu chat.

**Poin loyalitas.** 1 poin per Rp1.000. Penukaran hanya kelipatan 100 poin
(100 pt = Rp10.000), dibatasi 30% dari subtotal — batas itu juga dibulatkan ke
kelipatan 100 supaya angka yang ditawarkan selalu bisa ditukar.

**E-tiket.** QR dibangkitkan dari kode booking dengan `qrcode.react` (SVG
inline), jadi tetap bisa dibuka setelah halaman termuat sekali. Tombol
Bagikan memakai Web Share API dan jatuh ke papan klip kalau tidak ada;
Kalender mengunduh berkas .ics yang dibangun sendiri — lengkap dengan
pengingat 1 jam sebelum main dan RRULE mingguan untuk booking berulang.

**Aksi komunitas.** Gabung/batal open match, gabung tim, ajak sparring, dan
daftar turnamen semuanya memukul server tiruan dan mengubah data: kuota
bergerak, slot kosong berkurang, tombol berganti jadi keadaan "sudah". Ajakan
sparring muncul sebagai notifikasi baru.

**Notifikasi.** Bisa ditandai dibaca satu per satu atau sekaligus, dan titik
merah di Home menghitung yang benar-benar belum dibaca — bukan hiasan tetap.

**Ulasan.** Bisa ditulis dari layar ulasan. Rating venue dihitung ulang dari
ulasan yang benar-benar ada, supaya angka di kartu venue tidak pernah
bertentangan dengan daftar ulasannya sendiri.

**Persistensi.** Auth dan draft booking disimpan di localStorage dengan prefiks
`lapangin:`. `clearAll()` hanya menghapus kunci berprefiks itu — kunci milik
aplikasi lain di origin yang sama tidak pernah disentuh.

---

## Lapisan data

`src/mocks/handlers.ts` melayani seluruh `/api/*` dengan latensi buatan
300–800 ms supaya skeleton benar-benar terlihat (dimatikan otomatis saat tes).

Ketersediaan slot dihitung dari hash FNV-1a atas `lapangan + tanggal + jam`,
bukan `Math.random()`. Konsekuensinya penting: grid tidak berubah tiap render,
dan pertanyaan "apakah Jumat depan jam 19.00 kosong?" selalu dijawab sama —
tanpa itu deteksi bentrok jadwal berulang tidak bisa dipercaya.

### Memicu state error

State error di app ini nyata, bukan hiasan. Cara memancingnya:

| Kasus                     | Cara memicu                                                |
| ------------------------- | ---------------------------------------------------------- |
| Server error saat mencari | ketik `error` di kotak pencarian                           |
| Slot direbut saat bayar   | booking **Lap. 1** mana pun pada **jam 21.00**, lalu Bayar |
| Hold pembayaran habis     | diamkan layar pembayaran 10 menit                          |
| Slot keburu diambil       | pilih slot yang baru saja dikunci booking lain             |

---

## Tes

`npm test` — 106 tes, 12 berkas.

**Unit (`src/lib/*.test.ts`)** — perhitungan harga, penukaran poin dan batas
30%, pembulatan split bill (termasuk pembuktian bahwa jumlah seluruh bagian
sama persis dengan total), validasi slot bersambung, deteksi bentrok berulang,
pembangunan berkas .ics (escaping, lipatan baris per oktet, RRULE), dan jalur
mundur berbagi.

**Komponen (`src/routes/*.test.tsx`)** — aturan pilih slot di grid nyata,
kedaluwarsanya countdown pembayaran beserta efeknya ke state machine,
sinkronisasi filter ⇄ URL termasuk debounce, reset, state kosong, dan state
error, gabung/batal open match beserta penolakan saat kuota penuh, tandai
notifikasi dibaca, serta tulis ulasan termasuk validasi dan perhitungan ulang
rata-rata.

Tes komponen memakai handler MSW yang sama dengan app, jadi yang diuji kontrak
sungguhan — bukan mock yang ditulis ulang khusus untuk tes.

### Satu hal khusus di setup tes

`src/test/setup.ts` melepas `AbortSignal` dari setiap `fetch`. Lingkungan jsdom
mengganti `AbortController` global dengan miliknya sendiri, sementara `fetch`
bawaan Node menolak signal yang bukan instance miliknya — tanpa pembungkus itu
setiap permintaan gagal di tes meski kodenya benar di peramban. Pembatalan
request tetap aktif di aplikasi sungguhan.

---

## Sistem visual

Seluruh warna, radius, dan font berasal dari custom property di
`src/styles/tokens.css`, dipetakan ke nama Tailwind di `tailwind.config.ts`.
Tidak ada satu pun nilai heksadesimal di dalam komponen.

- Ground krem `--color-bg`, permukaan `--color-surface`
- Aksen terracotta `--color-accent`, aksen kedua sage `--color-accent-2`
- Heading Caprasimo, body Figtree
- Tombol dan input pill 999px, kontainer `--radius-lg`
- Ikon Lucide, `strokeWidth` 2.75 dipatok sekali di `components/ui/Icon.tsx`
- Ukuran teks terkecil 11px; target sentuh minimal 44px (`min-h-touch`)
- Foto venue diwakili blok warna beraksen + bentuk bulat dekoratif yang posisinya
  deterministik dari `seed`, bukan ilustrasi SVG

Token diturunkan dari design system **Organic** di project Claude Design
"Booking Court Mobile App" (`_ds/organic-…/styles.css`), dan bingkai perangkat
diadaptasi dari starter `android-frame.jsx` di project yang sama — dengan
warnanya ditarik ke token Organic, bukan palet Material bawaan starter.

### Aksesibilitas

Elemen semantik, semua input berlabel, ring fokus `2px solid var(--color-accent)`
yang selalu terlihat, `aria-live` untuk status pilihan slot dan countdown
pembayaran, grid slot bisa dioperasikan penuh dari keyboard, dan tiap daftar
punya keadaan memuat (skeleton, bukan spinner), kosong, dan gagal.

---

## Asumsi yang diambil

1. **Slot selalu 1 jam.** Semua aturan bersambung, harga, dan pembulatan
   dibangun di atas ini. Durasi 30 menit atau 90 menit butuh perubahan model.
2. **Jarak disajikan server.** `distanceKm` datang jadi dari backend; app tidak
   minta izin geolokasi maupun menghitung jarak sendiri.
3. **Prime time 18.00–21.00 naik 20%.** Angka tebakan yang wajar, bukan tarif
   asli — dan aturannya di satu tempat (`src/mocks/db.ts` → `priceFor`).
4. **Biaya layanan Rp5.000 flat per booking.**
5. **Tier loyalitas** Rookie / Reguler / Pro / Legend di ambang 0 / 500 / 2.000 /
   5.000 poin — angka karangan, gampang diganti di `src/lib/points.ts`.
6. **Sisa pembulatan split bill ke host.** Alternatifnya menyebar sisa ke
   beberapa orang, tapi itu membuat tiap orang ditagih angka berbeda tanpa
   alasan yang bisa dijelaskan.
7. **Hold pembayaran 10 menit** sesuai brief; venue asli biasanya 15–30 menit.
8. **Login lewat nomor HP tanpa OTP sungguhan.** Layar OTP belum dibuat; nomor
   yang valid langsung diterima.
9. **Lokasi dipatok "Bandung Utara"** dan tidak bisa diganti — pemilih lokasi
   belum ada.
10. **Satu bahasa (Indonesia).** Tidak ada infrastruktur i18n; teks ditulis
    langsung di komponen.

## Yang masih mock

- **Seluruh backend.** Tidak ada server, tidak ada database. Booking hidup di
  memori dan hilang saat halaman di-reload.
- **Pembayaran.** Tidak ada gateway. Menekan Bayar langsung mengonfirmasi;
  QRIS/VA/kartu hanya pilihan, tidak menghasilkan kode bayar sungguhan.
- **Foto venue.** Blok warna beraksen, bukan foto.
- **Menu Pengaturan** belum punya layar sendiri — ditandai "Segera" di profil.
- **Notifikasi push** tidak ada; yang ada hanya daftar di dalam app.
- **Chat** mengirim pesan ke store in-memory; tidak ada realtime.
- **Ajakan sparring** berhenti sebagai notifikasi; belum ada kotak masuk
  ajakan maupun alur terima/tolak.
- **Pendaftaran turnamen** tidak menagih biaya daftar; hanya menaikkan kuota.

## Yang perlu dikirim untuk melangkah ke hi-fi sungguhan

1. **Foto venue asli** — minimal 3 per venue, rasio 4:3, untuk menggantikan
   blok placeholder di galeri dan kartu.
2. **Logo Lapangin** — SVG, versi terang dan gelap, plus ikon app.
3. **Daftar harga sebenarnya** — tarif per lapangan per venue, aturan prime
   time yang benar, biaya layanan, dan harga add-on.
4. Opsional tapi berguna: daftar venue nyata beserta alamat dan jam buka,
   ketentuan pembatalan, dan aturan poin loyalitas yang sudah disepakati bisnis.
