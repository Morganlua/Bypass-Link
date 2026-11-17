// Noxis Tmp Mail v3 API Backend
const TM_API = "https://web2.temp-mail.org";
const JA3 = "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let cycleClient = null;
async function getCycleClient() {
  if (IS_VERCEL) return null;
  try {
    if (!cycleClient) {
      const { default: initCycleTLS } = await import("cycletls");
      cycleClient = await initCycleTLS();
    }
    return cycleClient;
  } catch { return null; }
}

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

async function requestTempMailOrg(path, method = "GET", token = null, body = undefined) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://temp-mail.org",
    referer: "https://temp-mail.org/",
    "user-agent": UA,
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
  const client = await getCycleClient();
  if (client) {
    try {
      const res = await client(`${TM_API}${path}`, { ja3: JA3, userAgent: UA, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, method.toLowerCase());
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      if (res.status >= 200 && res.status < 300 && data) return { ok: true, status: res.status, json: data };
    } catch {}
  }
  return await fastFetch(`${TM_API}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, 4500);
}

async function getAllDomains() {
  const [mtRes, mgRes, osmRes] = await Promise.all([
    fastFetch("https://api.mail.tm/domains", {}, 3500),
    fastFetch("https://api.mail.gw/domains", {}, 3500),
    fastFetch("https://www.1secmail.com/api/v1/?action=getDomainList", {}, 3500)
  ]);

  const list = [
    { domain: "temp-mail.org", provider: "tempmail", label: "temp-mail.org (Base Scrape Asli - Auto)" },
    { domain: "outlook.com", provider: "outlook", label: ".outlook.com — Microsoft Outlook Pool (DropMail)" },
    { domain: "hotmail.com", provider: "outlook", label: ".hotmail.com — Microsoft Hotmail Pool (DropMail)" }
  ];

  if (mtRes.ok && Array.isArray(mtRes.json?.["hydra:member"])) {
    for (const d of mtRes.json["hydra:member"]) {
      if (d.isActive) list.push({ domain: d.domain, provider: "mailtm", label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.tm VIP]` });
    }
  }
  if (mgRes.ok && Array.isArray(mgRes.json?.["hydra:member"])) {
    for (const d of mgRes.json["hydra:member"]) {
      if (d.isActive) list.push({ domain: d.domain, provider: "mailgw", label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.gw VIP]` });
    }
  }
  if (osmRes.ok && Array.isArray(osmRes.json)) {
    for (const d of osmRes.json) list.push({ domain: d, provider: "1secmail", label: `.${d.split(".").pop()} — ${d} [Fast Custom]` });
  }

  const extra = [
    { domain: "guerrillamail.org", provider: "guerrilla", label: ".org — guerrillamail.org [SPA]" },
    { domain: "guerrillamail.net", provider: "guerrilla", label: ".net — guerrillamail.net [SPA]" },
    { domain: "mail.ru", provider: "1secmail_ru", label: ".ru — mail.ru (Auto Route)" },
    { domain: "gmail.com", provider: "1secmail_gmail", label: ".gmail.com — gmail.com (Auto Route)" }
  ];

  const seen = new Set();
  return [...list, ...extra].filter(x => { if(seen.has(x.domain)) return false; seen.add(x.domain); return true; });
}

async function createMailTmFamily(baseUrl, providerName, cleanUser, requestedDomain) {
  const domRes = await fastFetch(`${baseUrl}/domains`, {}, 4000);
  const activeDomains = (domRes.json?.["hydra:member"] || []).filter(d => d.isActive).map(d => d.domain);
  if (!activeDomains.length) return { status: false, error: "Domain sedang penuh." };
  const targetDomain = activeDomains.includes(requestedDomain) ? requestedDomain : activeDomains[0];
  const password = `Noxis@${Math.random().toString(36).slice(2, 10)}9`;
  let address = `${cleanUser}@${targetDomain}`;
  let createRes = await fastFetch(`${baseUrl}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) }, 4500);
  if (!createRes.ok) {
    address = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${targetDomain}`;
    createRes = await fastFetch(`${baseUrl}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) }, 4500);
  }
  if (!createRes.ok) return { status: false, error: createRes.json?.["hydra:description"] || "Gagal membuat akun" };
  const tokenRes = await fastFetch(`${baseUrl}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) }, 4500);
  if (!tokenRes.ok || !tokenRes.json?.token) return { status: false, error: "Gagal mengambil token" };
  return { status: true, email: address, token: tokenRes.json.token, provider: providerName };
}

async function createDropMailOutlook(preferredDomain) {
  const token = `noxis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const endpoint = `https://dropmail.me/api/graphql/${token}`;
  const res = await fastFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation { introduceSession { id addresses { address } } }" }) }, 5000);
  const session = res.json?.data?.introduceSession;
  if (session?.id && session.addresses?.length) {
    return { status: true, email: session.addresses[0].address, token: `${token}|${session.id}`, provider: "outlook" };
  }
  return await createMailTmFamily("https://api.mail.gw", "mailgw", `outlook.${Math.random().toString(36).slice(2, 7)}`, "");
}

async function handleGenerate(username, domain, provider) {
  const cleanUser = (username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 22) || `noxis${Math.random().toString(36).substring(2, 8)}`;
  if (provider === "tempmail" || domain === "temp-mail.org") {
    const r = await requestTempMailOrg("/mailbox", "POST", null, {});
    if (r.ok && r.json?.mailbox && r.json?.token) return { status: true, email: r.json.mailbox, token: r.json.token, provider: "tempmail" };
    return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, "");
  }
  if (provider === "mailtm") return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, domain);
  if (provider === "mailgw") return await createMailTmFamily("https://api.mail.gw", "mailgw", cleanUser, domain);
  if (provider === "outlook" || domain === "outlook.com" || domain === "hotmail.com") return await createDropMailOutlook(domain);
  if (provider === "1secmail" || provider === "1secmail_ru" || provider === "1secmail_gmail") {
    let realDomain = domain;
    if (provider === "1secmail_ru" || provider === "1secmail_gmail" || domain === "mail.ru" || domain === "gmail.com") {
      const dRes = await fastFetch("https://www.1secmail.com/api/v1/?action=getDomainList", {}, 3000);
      realDomain = Array.isArray(dRes.json) && dRes.json.length ? dRes.json[0] : "1secmail.org";
    }
    return { status: true, email: `${cleanUser}@${realDomain}`, token: `${cleanUser}|${realDomain}`, provider: "1secmail" };
  }
  return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, domain);
}

async function handleInbox(email, token, provider) {
  if (provider === "tempmail") {
    const r = await requestTempMailOrg("/messages", "GET", token);
    const list = Array.isArray(r.json?.messages) ? r.json.messages : [];
    return { status: r.ok, messages: list.map(m => ({ id: m._id, from: m.from, subject: m.subject || "(Tanpa Subjek)", preview: m.bodyPreview || "", receivedAt: m.receivedAt ? new Date(m.receivedAt * 1000).toISOString() : new Date().toISOString() })) };
  }
  if (provider === "mailtm" || provider === "mailgw") {
    const baseUrl = provider === "mailgw" ? "https://api.mail.gw" : "https://api.mail.tm";
    const res = await fastFetch(`${baseUrl}/messages`, { headers: { Authorization: `Bearer ${token}` } }, 4500);
    const list = Array.isArray(res.json?.["hydra:member"]) ? res.json["hydra:member"] : [];
    return { status: res.ok, messages: list.map(m => ({ id: m.id, from: m.from?.address || m.from?.name || "Unknown", subject: m.subject || "(Tanpa Subjek)", preview: m.intro || "", receivedAt: m.createdAt || new Date().toISOString() })) };
  }
  if (provider === "outlook") {
    const [apiToken, sessionId] = (token || "").split("|");
    if (!apiToken || !sessionId) return { status: false, messages: [] };
    const res = await fastFetch(`https://dropmail.me/api/graphql/${apiToken}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: `query { session(id: "${sessionId}") { mails { id fromAddr headerSubject text receivedAt } } }` }) }, 4500);
    const mails = res.json?.data?.session?.mails || [];
    return { status: res.ok, messages: mails.map(m => ({ id: m.id, from: m.fromAddr || "Unknown", subject: m.headerSubject || "(Tanpa Subjek)", preview: (m.text || "").slice(0, 90), receivedAt: m.receivedAt || new Date().toISOString() })) };
  }
  if (provider === "1secmail") {
    const [login, domain] = (email || "").includes("@") ? email.split("@") : (token || "").split("|");
    const res = await fastFetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`, {}, 4500);
    const list = Array.isArray(res.json) ? res.json : [];
    return { status: res.ok, messages: list.map(m => ({ id: String(m.id), from: m.from, subject: m.subject || "(Tanpa Subjek)", preview: `Masuk pada ${m.date}`, receivedAt: m.date })) };
  }
  return { status: false, messages: [] };
}

async function handleRead(email, token, provider, id) {
  if (provider === "tempmail") {
    const r = await requestTempMailOrg(`/messages/${encodeURIComponent(id)}`, "GET", token);
    const d = r.json || {};
    return { status: r.ok, message: { id: d._id, from: d.from, subject: d.subject || "(Tanpa Subjek)", text: d.bodyPreview || "", html: d.bodyHtml || `<pre>${d.bodyPreview || ""}</pre>` } };
  }
  if (provider === "mailtm" || provider === "mailgw") {
    const baseUrl = provider === "mailgw" ? "https://api.mail.gw" : "https://api.mail.tm";
    const res = await fastFetch(`${baseUrl}/messages/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }, 4500);
    const m = res.json || {};
    const htmlBody = Array.isArray(m.html) ? m.html.join("") : (m.html || `<pre>${m.text || ""}</pre>`);
    return { status: res.ok, message: { id: m.id, from: m.from?.address || "Unknown", subject: m.subject || "(Tanpa Subjek)", text: m.text || "", html: htmlBody } };
  }
  if (provider === "outlook") {
    const [apiToken, sessionId] = (token || "").split("|");
    const res = await fastFetch(`https://dropmail.me/api/graphql/${apiToken}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: `query { session(id: "${sessionId}") { mails { id fromAddr headerSubject text html } } }` }) }, 4500);
    const mails = res.json?.data?.session?.mails || [];
    const m = mails.find(x => String(x.id) === String(id)) || {};
    return { status: res.ok, message: { id: m.id, from: m.fromAddr || "Unknown", subject: m.headerSubject || "(Tanpa Subjek)", text: m.text || "", html: m.html || `<pre>${m.text || ""}</pre>` } };
  }
  if (provider === "1secmail") {
    const [login, domain] = email.split("@");
    const res = await fastFetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`, {}, 4500);
    const m = res.json || {};
    return { status: res.ok, message: { id: String(m.id), from: m.from, subject: m.subject || "(Tanpa Subjek)", text: m.textBody || "", html: m.htmlBody || `<pre>${m.textBody || ""}</pre>` } };
  }
  return { status: false, error: "Gagal membaca" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const { action } = req.query;
  try {
    if (action === "domains") return res.status(200).json({ status: true, domains: await getAllDomains() });
    if (action === "generate") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      return res.status(200).json(await handleGenerate(body.username, body.domain, body.provider));
    }
    if (action === "inbox") {
      const { email, token, provider } = req.query;
      return res.status(200).json(await handleInbox(email, token, provider));
    }
    if (action === "read") {
      const { email, token, provider, id } = req.query;
      return res.status(200).json(await handleRead(email, token, provider, id));
    }
    return res.status(400).json({ status: false, error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
}
