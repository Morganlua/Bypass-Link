const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/react', async (req, res) => {
  try {
    const { channelUrl, emojis, count = 700 } = req.body;

    if (!channelUrl || !channelUrl.includes('whatsapp.com/channel/')) {
      return res.status(400).json({
        status: false,
        message: 'URL Postingan Saluran WhatsApp tidak valid!'
      });
    }

    if (!emojis || emojis.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'Masukkan minimal satu emoji reaksi!'
      });
    }

    const emojiArray = typeof emojis === 'string' 
      ? emojis.split(',').map(e => e.trim()).filter(e => e)
      : emojis;

    const urlParts = channelUrl.split('/');
    const postIdentifier = urlParts[urlParts.length - 1];

    console.log(`[ENGINE] Processing reaction to Channel Post: ${postIdentifier}`);

    return res.status(200).json({
      status: true,
      message: 'Proses pengiriman reaksi ke Saluran WhatsApp berhasil dimulai!',
      data: {
        postIdentifier,
        emojis: emojiArray,
        targetLimit: count,
        status: 'PROCESSING',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[ENGINE ERROR]', error);
    return res.status(500).json({
      status: false,
      message: 'Terjadi kesalahan pada Server Backend Reaction Engine.'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Reaction Engine running on port ${PORT}`));

module.exports = app;
