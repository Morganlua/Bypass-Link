const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
  // Set CORS Header
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Membaca raw buffer dari body upload
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentText = buffer.toString('utf-8');

    const patterns_found = [];

    // 1. Ekstraksi String Webhook (Discord / Telegram)
    const webhookRegex = /(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'`\]+|https?:\/\/api\.telegram\.org\/bot[^\s"'`\]+)/gi;
    const webhooks = [...new Set(contentText.match(webhookRegex) || [])];

    webhooks.forEach(url => {
      patterns_found.append ? null : patterns_found.push({
        type: "webhook",
        message: `🚨 <b>Webhook Berbahaya Ditemukan!</b> Target: <a href="${url}" target="_blank" rel="noopener">${url}</a>`
      });
    });

    // 2. Dekode XOR Brute-Force sederhana (1-255) di Node.js
    for (let key = 1; key < 256; key++) {
      const xored = Buffer.alloc(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        xored[i] = buffer[i] ^ key;
      }
      const xoredStr = xored.toString('utf-8');
      const matchedWebhooks = xoredStr.match(webhookRegex);
      if (matchedWebhooks) {
        matchedWebhooks.forEach(url => {
          if (!webhooks.includes(url)) {
            webhooks.push(url);
            patterns_found.push({
              type: "webhook",
              message: `🔓 <b>Webhook Tersembunyi (Terdekripsi XOR Key ${key})!</b> Target: <a href="${url}" target="_blank" rel="noopener">${url}</a>`
            });
          }
        });
      }
    }

    // 3. Deteksi Pustaka Jaringan
    const netKeywords = ["http.request", "socket.http", "ssl.https", "cjson", "copas", "requests"];
    netKeywords.forEach(kw => {
      if (contentText.toLowerCase().includes(kw.toLowerCase())) {
        patterns_found.push({
          type: "network",
          message: `⚠️ Terdeteksi pustaka pengiriman data eksternal/jaringan: <code>${kw}</code>`
        });
      }
    });

    // 4. Deteksi Fungsi Hooking Input / Keylogger
    const hookKeywords = ["onSendChat", "sampev.onSendChat", "onSendDialogResponse", "onKeyDown", "getClipboardText"];
    hookKeywords.forEach(kw => {
      if (contentText.toLowerCase().includes(kw.toLowerCase())) {
        patterns_found.push({
          type: "hook",
          message: `🔍 Terdeteksi fungsi penyadapan input/chat (Hooking): <code>${kw}</code>`
        });
      }
    });

    const isBytecode = buffer.slice(0, 4).toString('utf-8').includes('LJ') || buffer.slice(0, 4).toString('utf-8').includes('Lua');

    if (isBytecode && patterns_found.length === 0) {
      patterns_found.push({
        type: "warning",
        message: "🔒 File merupakan Bytecode LuaJIT terenkripsi rapat oleh loader. Disarankan ekstraksi memory dump saat runtime."
      });
    } else if (patterns_found.length === 0) {
      patterns_found.push({
        type: "safe",
        message: "✅ Tidak ditemukan indikator webhook atau fungsi keylogger standar pada file ini."
      });
    }

    return res.status(200).json({
      filename: "file.lua",
      size_kb: (buffer.length / 1024).toFixed(2),
      timestamp: new Date().toISOString(),
      patterns: patterns_found
    });

  } catch (error) {
    return res.status(500).json({ error: "Gagal memproses file: " + error.message });
  }
}
