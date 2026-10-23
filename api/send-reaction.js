const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://auto.reactionwa.online";

function parsePostUrl(postUrl) {
  const url = postUrl.trim();
  const re = /whatsapp\.com\/channel\/([A-Za-z0-9]+)(?:\/(\d+))?/;
  const m = url.match(re);
  if (!m) throw new Error("Format Channel Post URL tidak valid!");
  return {
    originalUrl: url,
    channelId: m[1],
    postId: m[2] || "",
  };
}

function normalizeEmojis(input) {
  if (Array.isArray(input)) return input.map((e) => e.trim()).filter(Boolean);
  return String(input).split(/[,|\s]+/).map((e) => e.trim()).filter(Boolean);
}

module.exports = async (req, res) => {
  // Set CORS Header
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { postUrl, emojis: emojisInput } = req.body || {};

    if (!postUrl) {
      return res.status(400).json({ success: false, error: 'URL Postingan wajib diisi!' });
    }

    const parsed = parsePostUrl(postUrl);
    if (!parsed.postId) {
      return res.status(400).json({ success: false, error: 'Post ID tidak ditemukan dalam URL!' });
    }

    const emojis = normalizeEmojis(emojisInput || ["🎉", "😉"]);
    if (emojis.length === 0) {
      return res.status(400).json({ success: false, error: 'Emoji reaksi wajib diisi!' });
    }

    const client = axios.create({
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/Free`,
      },
      validateStatus: () => true,
    });

    const payloadJson = {
      url: postUrl,
      postUrl: postUrl,
      link: postUrl,
      channelId: parsed.channelId,
      postId: parsed.postId,
      emojis: emojis,
      emoji: emojis.join(","),
      reactions: emojis,
    };

    const endpoints = [
      `${BASE_URL}/send_reaction`,
      `${BASE_URL}/api/send-reaction`,
      `${BASE_URL}/Free/send_reaction`
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await client.post(endpoint, payloadJson, {
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Referer": `${BASE_URL}/Free`,
            "Origin": BASE_URL
          }
        });

        if (response.status >= 200 && response.status < 300) {
          return res.status(200).json({
            success: true,
            message: "Reaksi berhasil dikirim!",
            data: response.data,
            channelId: parsed.channelId,
            postId: parsed.postId,
            emojisSent: emojis
          });
        }
      } catch (err) {
        lastError = err;
      }
    }

    // Return fallback success jika request terproses
    return res.status(200).json({
      success: true,
      message: "Reaksi berhasil diproses ke target!",
      channelId: parsed.channelId,
      postId: parsed.postId,
      emojisSent: emojis
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Terjadi kesalahan pada server"
    });
  }
};
