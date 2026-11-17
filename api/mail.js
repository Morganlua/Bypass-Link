// Noxis Tmp Mail v2 - Fast Multi-Provider + Base temp-mail.org Scrape + Outlook/Multi-Domain Router
const BASE_TEMPMAIL = "https://web2.temp-mail.org";
const JA3 = "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Fast fetch dengan timeout pendek agar UI selalu responsif
async function fastFetch(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.message };
  }
}

// Base Scrape temp-mail.org (Fast Direct HTTPS + Optional CycleTLS fallback jika di Node/VPS non-serverless)
async function tempMailRequest(path, method = "GET", token = null, body = undefined) {
  const headers = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "user-agent": UA,
    "origin": "https://temp-mail.org",
    "referer": "https://temp-mail.org/",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    ...(token ? { "authorization": `Bearer ${token}` } : {})
  };

  // 1. Direct fetch cepat (< 1 detik, aman untuk Vercel Serverless)
  const direct = await fastFetch(`${BASE_TEMPMAIL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }, 4500);

  if (direct.ok && direct.json) {
    return { ok: true, status: direct.status, data: direct.json };
  }

  // 2. Fallback CycleTLS hanya jika tidak berjalan di Vercel read-only lambda
  if (!process.env.VERCEL) {
    try {
      const { default: initCycleTLS } = await import("cycletls");
      const client = await initCycleTLS();
      const res = await client(
        `${BASE_TEMPMAIL}${path}`,
        {
          ja3: JA3,
          userAgent: UA,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        },
        method.toLowerCase()
      );
      const txt = await res.text();
      await client.exit();
      const parsed = JSON.parse(txt);
      return { ok: res.status >= 200 && res.status < 300, status: res.status, data: parsed };
    } catch (e) {
      return { ok: false, status: direct.status, error: e.message };
    }
  }

  return {
    ok: false,
    status: direct.status,
    error: direct.json?.errorMessage || direct.error || `HTTP ${direct.status} dari temp-mail.org`
  };
}

// Ambil semua domain aktif secara paralel (Paralel = super cepat < 1.5s)
async function getAllDomains() {
  const [mtRes, mgwRes, osmRes] = await Promise.all([
    fastFetch("https://api.mail.tm/domains", {}, 3500),
    fastFetch("https://api.mail.gw/domains", {}, 3500),
    fastFetch("https://www.1secmail.com/api/v1/?action=getDomainList", {}, 3500)
  ]);

  const list = [
    { domain: "temp-mail.org", provider: "tempmail", label: "temp-mail.org — Base Scrape Asli [VIP]" }
  ];

  // Mail.tm domains
  if (mtRes.ok && Array.isArray(mtRes.json?.["hydra:member"])) {
    for (const d of mtRes.json["hydra:member"]) {
      if (d.isActive) {
        list.push({ domain: d.domain, provider: "mailtm", label: `.${d.domain.split(".").pop()} — ${d.domain} [MAIL.TM]` });
      }
    }
  }

  // Mail.gw domains
  if (mgwRes.ok && Array.isArray(mgwRes.json?.["hydra:member"])) {
    for (const d of mgwRes.json["hydra:member"]) {
      if (d.isActive) {
        list.push({ domain: d.domain, provider: "mailgw", label: `.${d.domain.split(".").pop()} — ${d.domain} [MAIL.GW]` });
      }
    }
  }

  // 1secmail domains
  if (osmRes.ok && Array.isArray(osmRes.json)) {
    for (const d of osmRes.json) {
      list.push({ domain: d, provider: "1secmail", label: `.${d.split(".").pop()} — ${d} [INSTANT]` });
    }
  }

  // Domain Outlook, Gmail, Ru, Org, Com, Net (Auto-routed ke active MX inbox)
  const extraDomains = [
    { domain: "outlook.com", provider: "outlook_route", label: ".outlook.com — outlook.com [OUTLOOK]" },
    { domain: "outlook.co.id", provider: "outlook_route", label: ".outlook.co.id — outlook.co.id [OUTLOOK]" },
    { domain: "hotmail.com", provider: "outlook_route", label: ".hotmail.com — hotmail.com [OUTLOOK]" },
    { domain: "gmail.com", provider: "gmail_route", label: ".gmail.com — gmail.com [GMAIL ALIAS]" },
    { domain: "mail.ru", provider: "ru_route", label: ".ru — mail.ru [RU ROUTE]" },
    { domain: "guerrillamail.org", provider: "guerrilla", label: ".org — guerrillamail.org [SPA]" },
    { domain: "guerrillamail.net", provider: "guerrilla", label: ".net — guerrillamail.net [SPA]" },
    { domain: "guerrillamail.com", provider: "guerrilla", label: ".com — guerrillamail.com [SPA]" }
  ];

  const seen = new Set();
  const merged = [];
  for (const item of [...list, ...extraDomains]) {
    if (!seen.has(item.domain)) {
      seen.add(item.domain);
      merged.push(item);
    }
  }
  return merged;
}

// Helper akun Mail.tm / Mail.gw (cepat & tahan bentrok username)
async function createMailTmStyleAccount(baseUrl, providerName, cleanUser, targetDomain) {
  let domain = targetDomain;
  if (!domain) {
    const dRes = await fastFetch(`${baseUrl}/domains`, {}, 3500);
    domain = dRes.json?.["hydra:member"]?.[0]?.domain;
  }
  if (!domain) return { status: false, error: `Domain ${providerName} tidak tersedia` };

  const password = `Noxis@${Math.random().toString(36).slice(2, 10)}9`;
  let email = `${cleanUser}@${domain}`;

  let accRes = await fastFetch(`${baseUrl}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password })
  }, 4500);

  // Jika nama sudah dipakai orang lain, otomatis tambah 3 digit acak
  if (!accRes.ok) {
    email = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${domain}`;
    accRes = await fastFetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: email, password })
    }, 4500);
  }

  if (!accRes.ok) {
    return {
      status: false,
      error: accRes.json?.["hydra:description"] || accRes.json?.detail || `Gagal membuat akun ${providerName}`
    };
  }

  const tokRes = await fastFetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password })
  }, 4500);

  if (!tokRes.ok || !tokRes.json?.token) {
    return { status: false, error: `Gagal mengambil token ${providerName}` };
  }

  return {
    status: true,
    email,
    token: tokRes.json.token,
    provider: providerName
  };
}

// Generate Email
async function handleGenerate(username, domain, provider) {
  const cleanUser = (username || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 22) || `noxis${Math.random().toString(36).substring(2, 8)}`;

  // 1. Base Scrape temp-mail.org asli
  if (provider === "tempmail" || domain === "temp-mail.org") {
    const r = await tempMailRequest("/mailbox", "POST", null, {});
    if (r.ok && r.data?.mailbox && r.data?.token) {
      return {
        status: true,
        email: r.data.mailbox,
        token: r.data.token,
        provider: "tempmail"
      };
    }
    return {
      status: false,
      error: r.error || "temp-mail.org membatasi IP server (Cloudflare). Pilih domain MAIL.TM / MAIL.GW / OUTLOOK."
    };
  }

  // 2. Mail.tm
  if (provider === "mailtm") {
    return await createMailTmStyleAccount("https://api.mail.tm", "mailtm", cleanUser, domain);
  }

  // 3. Mail.gw
  if (provider === "mailgw") {
    return await createMailTmStyleAccount("https://api.mail.gw", "mailgw", cleanUser, domain);
  }

  // 4. Outlook / Hotmail / Gmail / RU Route -> Terhubung ke active Mail.tm/1secmail domain
  if (provider === "outlook_route" || provider === "gmail_route" || provider === "ru_route") {
    // Gunakan domain aktif dari Mail.tm terlebih dahulu (paling lolos filter OTP), fallback ke 1secmail
    const mt = await createMailTmStyleAccount("https://api.mail.tm", "mailtm", cleanUser, null);
    if (mt.status) return mt;
    const fallbackDomain = "1secmail.org";
    return {
      status: true,
      email: `${cleanUser}@${fallbackDomain}`,
      token: `${cleanUser}|${fallbackDomain}`,
      provider: "1secmail"
    };
  }

  // 5. 1secmail
  if (provider === "1secmail") {
    const target = domain || "1secmail.com";
    return {
      status: true,
      email: `${cleanUser}@${target}`,
      token: `${cleanUser}|${target}`,
      provider: "1secmail"
    };
  }

  // 6. GuerrillaMail
  if (provider === "guerrilla") {
    const initRes = await fastFetch("https://api.guerrillamail.com/ajax.php?f=get_email_address", {}, 4000);
    const sid = initRes.json?.sid_token;
    if (!sid) return { status: false, error: "Gagal koneksi ke GuerrillaMail" };
    const setRes = await fastFetch(
      `https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(cleanUser)}&lang=en&sid_token=${encodeURIComponent(sid)}`,
      {},
      4000
    );
    const userFinal = setRes.json?.email_user || cleanUser;
    return {
      status: true,
      email: `${userFinal}@${domain || "guerrillamail.com"}`,
      token: sid,
      provider: "guerrilla"
    };
  }

  return { status: false, error: "Provider tidak valid" };
}

// Get Inbox
async function handleInbox(email, token, provider) {
  if (provider === "tempmail") {
    const r = await tempMailRequest("/messages", "GET", token);
    const list = Array.isArray(r.data?.messages) ? r.data.messages : [];
    return {
      status: r.ok,
      messages: list.map((m) => ({
        id: m._id,
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        preview: m.bodyPreview || "",
        receivedAt: m.receivedAt ? new Date(m.receivedAt * 1000).toISOString() : new Date().toISOString()
      }))
    };
  }

  if (provider === "mailtm" || provider === "mailgw") {
    const baseUrl = provider === "mailgw" ? "https://api.mail.gw" : "https://api.mail.tm";
    const res = await fastFetch(`${baseUrl}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    }, 4500);
    const list = Array.isArray(res.json?.["hydra:member"]) ? res.json["hydra:member"] : [];
    return {
      status: res.ok,
      messages: list.map((m) => ({
        id: m.id,
        from: m.from?.address || m.from?.name || "Unknown",
        subject: m.subject || "(Tanpa Subjek)",
        preview: m.intro || "",
        receivedAt: m.createdAt || new Date().toISOString()
      }))
    };
  }

  if (provider === "1secmail") {
    const [login, domain] = (email || "").includes("@") ? email.split("@") : (token || "").split("|");
    const res = await fastFetch(
      `https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`,
      {},
      4500
    );
    const list = Array.isArray(res.json) ? res.json : [];
    return {
      status: res.ok,
      messages: list.map((m) => ({
        id: String(m.id),
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        preview: `Diterima: ${m.date}`,
        receivedAt: m.date
      }))
    };
  }

  if (provider === "guerrilla") {
    const res = await fastFetch(
      `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(token)}`,
      {},
      4500
    );
    const list = Array.isArray(res.json?.list) ? res.json.list : [];
    return {
      status: res.ok,
      messages: list.map((m) => ({
        id: String(m.mail_id),
        from: m.mail_from,
        subject: m.mail_subject || "(Tanpa Subjek)",
        preview: m.mail_excerpt || "",
        receivedAt: m.mail_date
      }))
    };
  }

  return { status: false, messages: [] };
}

// Read Message
async function handleRead(email, token, provider, id) {
  if (provider === "tempmail") {
    const r = await tempMailRequest(`/messages/${encodeURIComponent(id)}`, "GET", token);
    const m = r.data || {};
    return {
      status: r.ok,
      message: {
        id: m._id,
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        text: m.bodyPreview || "",
        html: m.bodyHtml || `<pre>${m.bodyPreview || ""}</pre>`,
        createdAt: m.createdAt
      }
    };
  }

  if (provider === "mailtm" || provider === "mailgw") {
    const baseUrl = provider === "mailgw" ? "https://api.mail.gw" : "https://api.mail.tm";
    const res = await fastFetch(`${baseUrl}/messages/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    }, 4500);
    const m = res.json || {};
    const htmlBody = Array.isArray(m.html) ? m.html.join("") : (m.html || `<pre>${m.text || ""}</pre>`);
    return {
      status: res.ok,
      message: {
        id: m.id,
        from: m.from?.address || "Unknown",
        subject: m.subject || "(Tanpa Subjek)",
        text: m.text || "",
        html: htmlBody,
        createdAt: m.createdAt
      }
    };
  }

  if (provider === "1secmail") {
    const [login, domain] = email.split("@");
    const res = await fastFetch(
      `https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`,
      {},
      4500
    );
    const m = res.json || {};
    return {
      status: res.ok,
      message: {
        id: String(m.id),
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        text: m.textBody || "",
        html: m.htmlBody || `<pre>${m.textBody || ""}</pre>`,
        createdAt: m.date
      }
    };
  }

  if (provider === "guerrilla") {
    const res = await fastFetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(id)}&sid_token=${encodeURIComponent(token)}`,
      {},
      4500
    );
    const m = res.json || {};
    return {
      status: res.ok,
      message: {
        id: String(m.mail_id),
        from: m.mail_from,
        subject: m.mail_subject || "(Tanpa Subjek)",
        text: m.mail_body || "",
        html: m.mail_body || "",
        createdAt: m.mail_date
      }
    };
  }

  return { status: false, error: "Gagal membaca pesan" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  try {
    if (action === "domains") {
      const domains = await getAllDomains();
      return res.status(200).json({ status: true, domains });
    }

    if (action === "generate") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { username, domain, provider } = body;
      const result = await handleGenerate(username, domain, provider);
      return res.status(result.status ? 200 : 400).json(result);
    }

    if (action === "inbox") {
      const { email, token, provider } = req.query;
      const result = await handleInbox(email, token, provider);
      return res.status(200).json(result);
    }

    if (action === "read") {
      const { email, token, provider, id } = req.query;
      const result = await handleRead(email, token, provider, id);
      return res.status(200).json(result);
    }

    return res.status(400).json({ status: false, error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
}
