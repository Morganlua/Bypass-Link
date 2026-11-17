# Noxis Tmp Mail v2

Created By Noxis Protection Free Email Trial.

## Perbaikan Utama (v2)
- **Fast Generate (< 1 Detik)**: Menghilangkan blocking binary Go `cycletls` di serverless Vercel menggunakan direct HTTPS fetch + header JA3-compatible browser headers (dengan fallback `cycletls` otomatis untuk environment VPS/Node lokal), sehingga `temp-mail.org` (`web2.temp-mail.org`) dan `mail.tm` langsung aktif tanpa timeout.
- **Base Scrape `temp-mail.org` Asli**: Endpoint `/mailbox`, `/messages`, dan `/messages/:id` langsung terhubung ke `https://web2.temp-mail.org` dengan Bearer JWT token asli.
- **Support Domain Outlook & Multi-Domain**: Menambahkan routing domain `.outlook.com` / `.outlook.co.id` / `.hotmail.com`, `.ru`, `.org`, `.gmail.com`, `.com`, `.net`, serta domain aktif real-time dari `mail.tm`, `mail.gw`, `dropmail`, dan `1secmail`.
