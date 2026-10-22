/**
 * Khaddavi, BicoLink, Sub2Unlock & Move2Link Safelink Bypasser & Article Scraper
 * Creator: AlcaW44
 * Base: https://app.khaddavi.net
 * Saluran: https://whatsapp.com/channel/0029Vb82nkLEwEjtLSQ49I44
 */

const axios = require('axios');
const cheerio = require('cheerio');

const SALURAN = 'https://whatsapp.com/channel/0029Vb82nkLEwEjtLSQ49I44';
const CREATOR = 'AlcaW44';
const BASE_URL = 'https://app.khaddavi.net';
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
        
        // Daftar domain internal safelink yang harus diabaikan
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

    // 1. Deteksi Variabel JavaScript & Base64 di dalam Script (BicoLink / Sub2Unlock / Move2Link)
    const scripts = $('script').toArray();
    for (const s of scripts) {
        const scriptText = $(s).html() || '';
        
        // Pola pencarian variabel penampung URL tujuan
        const targetMatch = scriptText.match(/(?:var|let|const)\s+(?:targetUrl|destination|dest_url|final_link|redirectUrl|link)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
        if (targetMatch && isExternalDestination(targetMatch[1], currentHost)) {
            return targetMatch[1];
        }

        // Pola pencarian token Base64 di dalam script objek
        const b64Match = scriptText.match(/(?:target|link|url|dest)\s*:\s*['"]([A-Za-z0-9+/=]{20,})['"]/i);
        if (b64Match) {
            const decoded = decodeBase64(b64Match[1]);
            if (decoded && isExternalDestination(decoded, currentHost)) {
                return decoded;
            }
        }
    }

    // 2. Meta Refresh Tag
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

    // 3. Meta OpenGraph Description
    const metaOg = $('meta[property="og:description" i], meta[name="og:description" i]').attr('content');
    if (metaOg) {
        const m = metaOg.match(/https?:\/\/[^\s<>"']+/i);
        if (m && isExternalDestination(m[0], currentHost)) {
            return m[0];
        }
    }

    // 4. Hidden Form Inputs (BicoLink / Move2Link / WPSafelink)
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

    // 5. Form Actions
    const formAction = $('form#slu-form, form#safelink, form[action*="safelinku"], form#bico-form, form#move-form').attr('action');
    if (formAction && isExternalDestination(formAction, currentHost)) {
        return formAction;
    }

    // 6. Tombol / Button / Link Spesifik
    const btnSelectors = '#slu-btn[href], a.slu-btn[href], #btn-main[href], a#get-link[href], a.btn-success[href], a#continue[href], a.btn-download[href]';
    const btnHref = $(btnSelectors).attr('href');
    if (btnHref) {
        const resolved = resolvePayload(btnHref);
        if (resolved && isExternalDestination(resolved, currentHost)) return resolved;
        if (isExternalDestination(btnHref, currentHost)) return btnHref;
    }

    // 7. Scanning Anchor Links Umum (`<a>`)
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

async function bypass(shortUrl) {
    const startTime = Date.now();
    const raw = String(shortUrl || '').trim();

    if (!raw || !/^https?:\/\//i.test(raw)) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: 'URL shortlink/safelink tidak valid. Contoh: https://app.khaddavi.net/?an=...'
        };
    }

    try {
        const directCheck = resolvePayload(raw);
        if (directCheck && /^https?:\/\//i.test(directCheck) && !directCheck.includes('khaddavi.') && !directCheck.includes('bicolink.')) {
            return {
                Creator: CREATOR,
                Saluran: SALURAN,
                time: `${Date.now() - startTime}ms`,
                status: true,
                data: {
                    original_url: raw,
                    destination_url: directCheck,
                    method: 'URL Parameter / Payload Decode'
                }
            };
        }

        const res = await axios.get(raw, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://www.google.com/'
            },
            maxRedirects: 5,
            timeout: 15000
        });

        const finalUrl = res.request && res.request.res ? res.request.res.responseUrl || raw : raw;
        const html = res.data;

        const dest = extractDestinationFromHtml(html, finalUrl);
        if (dest) {
            return {
                Creator: CREATOR,
                Saluran: SALURAN,
                time: `${Date.now() - startTime}ms`,
                status: true,
                data: {
                    original_url: raw,
                    destination_url: dest,
                    final_page_url: finalUrl,
                    method: 'HTML Safelink / DOM Extraction'
                }
            };
        }

        if (finalUrl !== raw && isExternalDestination(finalUrl, new URL(raw).hostname.toLowerCase())) {
            return {
                Creator: CREATOR,
                Saluran: SALURAN,
                time: `${Date.now() - startTime}ms`,
                status: true,
                data: {
                    original_url: raw,
                    destination_url: finalUrl,
                    method: 'HTTP Redirection'
                }
            };
        }

        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: 'Tidak ditemukan link tujuan eksternal dari URL safelink tersebut'
        };
    } catch (err) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: err.message || 'Gagal bypass shortlink'
        };
    }
}

async function getLatest(page = 1) {
    const startTime = Date.now();
    const pageNum = parseInt(page, 10) || 1;
    const target = pageNum > 1 ? `${BASE_URL}/page/${pageNum}/` : `${BASE_URL}/`;

    try {
        const res = await axios.get(target, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });

        const $ = cheerio.load(res.data);
        const posts = [];

        $('article').each((_, el) => {
            const title = $(el).find('.entry-title a').text().trim();
            const link = $(el).find('.entry-title a').attr('href');
            const img = $(el).find('.post-image img').attr('src') || null;
            const time = $(el).find('time.entry-date').text().trim() || null;
            const excerpt = $(el).find('.entry-summary, .entry-content').text().trim() || null;

            if (title && link) {
                posts.push({
                    title,
                    url: link,
                    thumbnail: img,
                    date: time,
                    excerpt: excerpt ? excerpt.slice(0, 150) + '...' : null
                });
            }
        });

        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: true,
            data: {
                page: pageNum,
                total_posts: posts.length,
                posts: posts
            }
        };
    } catch (err) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: err.message || 'Gagal mengambil artikel terbaru'
        };
    }
}

async function search(query, page = 1) {
    const startTime = Date.now();
    const q = String(query || '').trim();

    if (!q) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: 'Kata kunci pencarian tidak boleh kosong'
        };
    }

    const pageNum = parseInt(page, 10) || 1;
    const target = `${BASE_URL}/?s=${encodeURIComponent(q)}&paged=${pageNum}`;

    try {
        const res = await axios.get(target, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });

        const $ = cheerio.load(res.data);
        const results = [];

        $('article').each((_, el) => {
            const title = $(el).find('.entry-title a').text().trim();
            const link = $(el).find('.entry-title a').attr('href');
            const img = $(el).find('.post-image img').attr('src') || null;
            const time = $(el).find('time.entry-date').text().trim() || null;

            if (title && link) {
                results.push({
                    title,
                    url: link,
                    thumbnail: img,
                    date: time
                });
            }
        });

        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: true,
            data: {
                query: q,
                page: pageNum,
                total_results: results.length,
                results: results
            }
        };
    } catch (err) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: err.message || 'Gagal mencari artikel'
        };
    }
}

async function read(articleUrl) {
    const startTime = Date.now();
    const raw = String(articleUrl || '').trim();

    if (!raw || !/^https?:\/\//i.test(raw)) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: 'URL artikel tidak valid'
        };
    }

    try {
        const res = await axios.get(raw, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });

        const $ = cheerio.load(res.data);
        const title = $('h1.entry-title').text().trim();
        const date = $('time.entry-date').text().trim() || null;
        const author = $('.author-name, .byline').text().trim() || null;
        const thumbnail = $('.post-image img, .wp-post-image').attr('src') || null;

        const categories = [];
        $('.entry-meta a[rel="category tag"], .cat-links a').each((_, el) => {
            categories.push($(el).text().trim());
        });

        const tags = [];
        $('.tags-links a').each((_, el) => {
            tags.push($(el).text().trim());
        });

        const paragraphs = [];
        $('.entry-content p').each((_, el) => {
            const p = $(el).text().trim();
            if (p) paragraphs.push(p);
        });

        const downloads = [];
        $('.entry-content a[href]').each((_, el) => {
            const h = $(el).attr('href');
            const txt = $(el).text().trim();
            if (h && (txt.toLowerCase().includes('download') || h.includes('download') || h.includes('drive.google') || h.includes('mediafire') || h.includes('sfile') || h.includes('mega.nz'))) {
                downloads.push({
                    title: txt || 'Download Link',
                    url: h
                });
            }
        });

        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: true,
            data: {
                title: title || null,
                url: raw,
                author: author,
                published_at: date,
                thumbnail: thumbnail,
                categories: categories,
                tags: tags,
                content: paragraphs.join('\n\n'),
                downloads: downloads
            }
        };
    } catch (err) {
        return {
            Creator: CREATOR,
            Saluran: SALURAN,
            time: `${Date.now() - startTime}ms`,
            status: false,
            error: err.message || 'Gagal membaca artikel'
        };
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage:\n node khaddavi.js bypass <shortlink_url>\n node khaddavi.js latest [page]\n node khaddavi.js search <query> [page]\n node khaddavi.js read <article_url>');
        process.exit(1);
    }

    const command = args[0].toLowerCase();

    if (command === 'bypass') {
        const url = args[1];
        if (!url) {
            console.log('Usage:\n node khaddavi.js bypass <shortlink_url>');
            process.exit(1);
        }
        const res = await bypass(url);
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    if (command === 'latest') {
        const page = args[1] || 1;
        const res = await getLatest(page);
        console.log(JSON.stringify(res, null, 2));
        return;
    } else if (/^\d+$/.test(command)) {
        const res = await getLatest(command);
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    if (command === 'search') {
        const query = args[1];
        const page = args[2] || 1;
        if (!query) {
            console.log('Usage:\n node khaddavi.js search <query> [page]');
            process.exit(1);
        }
        const res = await search(query, page);
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    if (command === 'read') {
        const url = args[1];
        if (!url) {
            console.log('Usage:\n node khaddavi.js read <article_url>');
            process.exit(1);
        }
        const res = await read(url);
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    if (/^https?:\/\//i.test(command)) {
        const res = await bypass(command);
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    console.log('Usage:\n node khaddavi.js bypass <shortlink_url>\n node khaddavi.js latest [page]\n node khaddavi.js search <query> [page]\n node khaddavi.js read <article_url>');
    process.exit(1);
}

module.exports = {
    bypass,
    getLatest,
    search,
    read,
    resolvePayload
};

if (require.main === module) {
    main();
  }
              
