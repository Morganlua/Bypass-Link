# Noxis Tmp Mail v2

Created By Noxis Protection Free Email Trial.

## Perbaikan Utama v2
1. **Generate Instan (< 1 detik)**: Menghilangkan bottleneck timeout saat `CycleTLS` binary dipanggil di serverless Vercel (langsung menggunakan fast-path HTTP + JA3 headers ke `web2.temp-mail.org` dan memakai `initCycleTLS()` otomatis saat berjalan di Node/VPS/Termux).
2. **Base Scrape Asli `temp-mail.org` + `mail.tm` Diperbaiki**:
   - Endpoint `https://web2.temp-mail.org/mailbox` & `/messages` dibersihkan parsing-nya agar langsung mendapatkan `{ mailbox, token }` tanpa gagal.
   - `mail.tm` dan `mail.gw` kini otomatis mengambil domain aktif terbaru dari `/domains` sehingga tidak pernah mengirim domain kadaluarsa.
3. **Support Domain Outlook / Hotmail & Multi-Ekstensi**:
   - Mendukung `.outlook.com` / `.hotmail.com` (via DropMail GraphQL session & alias routing), `.ru`, `.org`, `.com`, `.net`, dan `.gmail.com`.

## Cara Deploy ke Vercel / GitHub
1. Upload seluruh isi folder hasil ekstrak ke repository **GitHub**.
2. Import di **Vercel** dan klik **Deploy**.
3. Untuk menjalankan lokal di Termux/VPS dengan full CycleTLS Go binary: jalankan `npm install && npm start`.
