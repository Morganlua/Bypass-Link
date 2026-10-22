const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeBase64(str) {
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch (_) {
    return '';
  }
}

function unwrapGoogle(target) {
  try {
    const parsed = new URL(target);
    if (parsed.hostname.includes('google.') && parsed.pathname === '/url') {
      const inner = parsed.searchParams.get('url') || parsed.searchParams.get('q');
      if (inner && /^https?:\/\//i.test(inner)) {
        return inner;
      }
    }
  } catch (_) {}
  return '';
}

function resolvePayload(value, depth = 0) {
  if (!value || depth > 4) return '';
  const raw = String(value).trim();

  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      const queryKeys = ['safelink_redirect', 'url', 'target', 'goto', 'r', 'out', 'u', 'link', 'data', 'an', 'dest', 'redirect', 'to'];
      for (const key of queryKeys) {
        const val = parsed.searchParams.get(key);
        if (val) {
          const resolved = resolvePayload(val, depth + 1);
          if (resolved && /^https?:\/\//i.test(resolved)) return resolved;
        }
      }
      const unwrap = unwrapGoogle(raw);
      if (unwrap) return unwrap;
    }
  } catch (_) {}

  const decoded = decodeBase64(raw);
  if (decoded && decoded !== raw) {
    if (/^https?:\/\//i.test(decoded)) {
      const unwrap = unwrapGoogle(decoded);
      return unwrap || decoded;
    }
    try {
      const json = JSON.parse(decoded);
      const nested = json.safelink || json.link || json.url || json.linkr || json.target || json.destination || json.dest || json.target_url;
      if (nested) {
        const resolved = resolvePayload(nested, depth + 1);
        if (resolved) return resolved;
      }
    } catch (_) {}
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return '';
}

function isExternalDestination(u, currentHost) {
  try {
    if (!/^https?:\/\//i.test(u)) return false;
    const parsed = new URL(u);
    const h = parsed.hostname.toLowerCase();
    
    const internalHosts = [
      'khaddavi.', 'contentmenarik.com', 'bicolink.', 'bico.site', 
      'sub2unlock.', 'sub4unlock.', 'move2link.', 'move2.link'
    ];
    
    if (internalHosts.some(ih => h.includes(ih)) || h === currentHost) {
      return false;
    }
    if (h.includes('google.') && (parsed.pathname === '/' || parsed.pathname === '/search')) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function extractDestinationFromHtml(html, currentUrl) {
  const $ = cheerio.load(html);
  const parsedCurrent = new URL(currentUrl);
  const currentHost = parsedCurrent.hostname.toLowerCase();

  const scripts = $('script').toArray();
  for (const s of scripts) {
    const scriptText = $(s).html() || '';
    const targetMatch = scriptText.match(/(?:var|let|const)\s+(?:targetUrl|destination|dest_url|final_link|redirectUrl)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
    if (targetMatch && isExternalDestination(targetMatch[1], currentHost)) {
      return targetMatch[1];
    }

    const b64Match = scriptText.match(/(?:target|link|url)\s*:\s*['"]([A-Za-z0-9+/=]{20,})['"]/i);
    if (b64Match) {
      const decoded = decodeBase64(b64Match[1]);
      if (decoded && isExternalDestination(decoded, currentHost)) {
        return decoded;
      }
    }
  }

  const metaRefresh = $('meta[http-equiv="refresh" i]').attr('content');
  if (metaRefresh) {
    const m = metaRefresh.match(/url=([^;]+)/i);
    if (m) {
      const refreshUrl = m[1].replace(/['"]/g, '').trim();
      const unwrap = unwrapGoogle(refreshUrl);
      const target = unwrap || refreshUrl;
      if (isExternalDestination(target, currentHost)) return target;
      const resolved = resolvePayload(target);
      if (resolved && isExternalDestination(resolved, currentHost)) return resolved;
    }
  }

  const inputSelectors = [
    'input[name="safelink_redirect"]',
    'input[name="go"]',
    'input[name="newwpsafelink"]',
    'input[name="wpsafelink"]',
    'input[name="wpsafelink_redirect"]',
    'input[name="destination"]',
    'input[name="target"]',
    'input#link',
    'input#url'
  ];
  for (const sel of inputSelectors) {
    const val = $(sel).val();
    if (val) {
      const resolved = resolvePayload(val);
      if (resolved && isExternalDestination(resolved, currentHost)) return resolved;
    }
  }

  const formAction = $('form#slu-form, form#safelink, form[action*="safelinku"], form#bico-form, form#move-form').attr('action');
  if (formAction && isExternalDestination(formAction, currentHost)) {
    return formAction;
  }

  const btnSelectors = '#slu-btn[href], a.slu-btn[href], #btn-main[href], a#get-link[href], a.btn-success[href], a#continue[href]';
  const btnHref = $(btnSelectors).attr('href');
  if (btnHref) {
    const resolved = resolvePayload(btnHref);
    if (resolved && isExternalDestination(resolved, currentHost)) return resolved;
    if (isExternalDestination(btnHref, currentHost)) return btnHref;
  }

  const links = $('a[href]').toArray();
  for (const el of links) {
    const h = $(el).attr('href');
    if (h && isExternalDestination(h, currentHost)) {
      const txt = $(el).text().toLowerCase();
      if (txt.includes('download') || txt.includes('get link') || txt.includes('lanjut') || txt.includes('direct') || txt.includes('unlock link') || txt.includes('go to link')) {
        return h;
      }
    }
  }

  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let url = req.query.url || (req.body && req.body.url);
  if (!url) {
    return res.status(400).json({ status: false, error: 'URL shortlink wajib diisi' });
  }

  const raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) {
    return res.status(400).json({ status: false, error: 'Format URL tidak valid (harus diawali http/https)' });
  }

  try {
    const directCheck = resolvePayload(raw);
    if (directCheck && /^https?:\/\//i.test(directCheck) && !directCheck.includes('khaddavi.') && !directCheck.includes('bicolink.')) {
      return res.status(200).json({
        status: true,
        data: { original_url: raw, destination_url: directCheck, method: 'URL Parameter / Payload Decode' }
      });
    }

    const response = await axios.get(raw, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      maxRedirects: 5,
      timeout: 15000
    });

    const finalUrl = response.request && response.request.res ? response.request.res.responseUrl || raw : raw;
    const html = response.data;

    const dest = extractDestinationFromHtml(html, finalUrl);
    if (dest) {
      return res.status(200).json({
        status: true,
        data: { original_url: raw, destination_url: dest, final_page_url: finalUrl, method: 'HTML / DOM Extraction' }
      });
    }

    if (finalUrl !== raw && isExternalDestination(finalUrl, new URL(raw).hostname.toLowerCase())) {
      return res.status(200).json({
        status: true,
        data: { original_url: raw, destination_url: finalUrl, method: 'HTTP Redirection' }
      });
    }

    return res.status(400).json({ status: false, error: 'Gagal menemukan link tujuan eksternal' });

  } catch (err) {
    return res.status(500).json({ status: false, error: err.message || 'Gagal memproses bypass' });
  }
};
