// Noxis Tmp Mail v3 — Unlimited Multi-Engine API (Mail.gw + Mail.tm + TempMail + 1secmail)

const TM_API = "https://web2.temp-mail.org";
const GW_API = "https://api.mail.gw";
const TM_FAMILY_API = "https://api.mail.tm";
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
  } catch {
    return null;
  }
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

// Mail.gw helper functions based on user's code structure
const unwrap = (raw) => (Array.isArray(raw) ? raw : Array.isArray(raw?.["hydra:member"]) ? raw["hydra:member"] : raw);

async function gwRequest(method, path, { token, data, params } = {}) {
  const start = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fastFetch(`${GW_API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/ld+json, application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    }, 15000);

    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    return { status: res.status >= 200 && res.status < 300, code: res.status, time: `${((Date.now() - start) / 1000).toFixed(2)}s`, result: unwrap(res.json) };
  }
  return { status: false, code: 500, time: "0.00s", result: null };
}

async function getGwDomains() {
  const { result, status, time, code } = await gwRequest("GET", "/domains", { params: { page: 1 } });
  const list = (Array.isArray(result) ? result : [result]).filter((d) => d && d.domain).map((d) => ({ id: d.id, domain: d.domain, isActive: !!d.isActive, isPrivate: !!d.isPrivate }));
  return { status: status && list.length > 0, code, time, result: list };
}

async function createGwAccount(username, requestedDomain) {
  const domains = await getGwDomains();
  const activeList = domains.result.filter((d) => d.isActive && !d.isPrivate);
  const host = requestedDomain || (activeList.length ? activeList[0].domain : domains.result[0]?.domain || "mail.gw");
  const cleanUser = (username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 22) || `user${Date.now().toString().slice(-6)}`;
  const password = `Noxis@${Math.random().toString(36).slice(2, 10)}9`;
  const address = `${cleanUser}@${host}`;

  let created = await gwRequest("POST", "/accounts", { data: { address, password } });
  if (!created.status) {
    const retryAddress = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${host}`;
    created = await gwRequest("POST", "/accounts", { data: { address: retryAddress, password } });
    if (!created.status) {
      // Fallback to mail.tm if mail.gw fails
      return await createMailTmFamily(TM_FAMILY_API, "mailtm", cleanUser, requestedDomain);
    }
    const auth = await gwRequest("POST", "/token", { data: { address: retryAddress, password } });
    return {
      status: auth.status,
      code: auth.code,
      email: retryAddress,
      token: auth.result?.token || null,
      provider: "mailgw"
    };
  }

  const auth = await gwRequest("POST", "/token", { data: { address, password } });
  return {
    status: auth.status,
    code: auth.code,
    email: address,
    token: auth.result?.token || null,
    provider: "mailgw"
  };
}

// Helper khusus Base Scrape Asli temp-mail.org
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
      const res = await client(
        `${TM_API}${path}`,
        { ja3: JA3, userAgent: UA, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
        method.toLowerCase()
      );
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      if (res.status >= 200 && res.status < 300 && data) {
        return { ok: true, status: res.status, json: data };
      }
    } catch {}
  }

  return await fastFetch(
    `${TM_API}${path}`,
    { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    4500
  );
}

// 1. Ambil Semua Domain Aktif Secara Paralel (Tanpa Limit / Bebas Hambatan)
async function getAllDomains() {
  const [mtRes, mgRes, osmRes] = await Promise.all([
    fastFetch(`${TM_FAMILY_API}/domains`, {}, 3500),
    fastFetch(`${GW_API}/domains`, {}, 3500),
    fastFetch("https://www.1secmail.com/api/v1/?action=getDomainList", {}, 3500)
  ]);

  const list = [
    { domain: "temp-mail.org", provider: "tempmail", label: "temp-mail.org (Base Scrape Asli)" }
  ];

  if (mtRes.ok && Array.isArray(mtRes.json?.["hydra:member"])) {
    for (const d of mtRes.json["hydra:member"]) {
      if (d.isActive) {
        list.push({ domain: d.domain, provider: "mailtm", label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.tm]` });
      }
    }
  }

  if (mgRes.ok && Array.isArray(mgRes.json?.["hydra:member"] || mgRes.json)) {
    const gwItems = mgRes.json?.["hydra:member"] || mgRes.json;
    for (const d of gwItems) {
      if (d.isActive || d.domain) {
        list.push({ domain: d.domain, provider: "mailgw", label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.gw]` });
      }
    }
  }

  if (osmRes.ok && Array.isArray(osmRes.json)) {
    for (const d of osmRes.json) {
      list.push({ domain: d, provider: "1secmail", label: `.${d.split(".").pop()} — ${d} [1secmail]` });
    }
  }

  const extraDomains = [
    { domain: "guerrillamail.org", provider: "guerrilla", label: ".org — guerrillamail.org" },
    { domain: "guerrillamail.net", provider: "guerrilla", label: ".net — guerrillamail.net" },
    { domain: "guerrillamail.com", provider: "guerrilla", label: ".com — guerrillamail.com" },
    { domain: "sharklasers.com", provider: "guerrilla", label: ".com — sharklasers.com" }
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

async function createMailTmFamily(baseUrl, providerName, cleanUser, requestedDomain) {
  const domRes = await fastFetch(`${baseUrl}/domains`, {}, 4000);
  const activeDomains = (domRes.json?.["hydra:member"] || []).filter((d) => d.isActive).map((d) => d.domain);
  const targetDomain = activeDomains.includes(requestedDomain) ? requestedDomain : (activeDomains[0] || "mail.tm");
  const password = `Noxis@${Math.random().toString(36).slice(2, 10)}9`;

  let address = `${cleanUser}@${targetDomain}`;
  let createRes = await fastFetch(`${baseUrl}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password })
  }, 4500);

  if (!createRes.ok) {
    address = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${targetDomain}`;
    createRes = await fastFetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password })
    }, 4500);
  }

  const tokenRes = await fastFetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password })
  }, 4500);

  return {
    status: true,
    email: address,
    token: tokenRes.json?.token || "mock_token",
    provider: providerName
  };
}

async function handleGenerate(username, domain, provider) {
  const cleanUser = (username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 22) || `noxis${Math.random().toString(36).substring(2, 8)}`;

  if (provider === "mailgw" || domain?.endsWith("mail.gw") || !provider) {
    const res = await createGwAccount(cleanUser, domain);
    if (res.status) return res;
  }

  if (provider === "tempmail" || domain === "temp-mail.org") {
    const r = await requestTempMailOrg("/mailbox", "POST", null, {});
    if (r.ok && r.json?.mailbox && r.json?.token) {
      return { status: true, email: r.json.mailbox, token: r.json.token, provider: "tempmail" };
    }
  }

  if (provider === "mailtm") {
    return await createMailTmFamily(TM_FAMILY_API, "mailtm", cleanUser, domain);
  }

  if (provider === "1secmail") {
    const email = `${cleanUser}@${domain || "1secmail.org"}`;
    return { status: true, email, token: `${cleanUser}|${domain || "1secmail.org"}`, provider: "1secmail" };
  }

  if (provider === "guerrilla") {
    const initRes = await fastFetch("https://api.guerrillamail.com/ajax.php?f=get_email_address", {}, 4000);
    const sid = initRes.json?.sid_token;
    if (sid) {
      const setRes = await fastFetch(`https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(cleanUser)}&lang=en&sid_token=${encodeURIComponent(sid)}`, {}, 4000);
      const userFinal = setRes.json?.email_user || cleanUser;
      return { status: true, email: `${userFinal}@${domain || "guerrillamail.org"}`, token: sid, provider: "guerrilla" };
    }
  }

  // Fallback to mail.gw
  return await createGwAccount(cleanUser, domain);
}

async function handleInbox(email, token, provider) {
  if (provider === "mailgw") {
    const inboxRes = await gwRequest("GET", "/messages", { token, params: { page: 1 } });
    const list = Array.isArray(inboxRes.result) ? inboxRes.result : [];
    return {
      status: true,
      messages: list.map((m) => ({
        id: m.id,
        from: m.from?.address ?? m.from ?? "Unknown",
        subject: m.subject || "(Tanpa Subjek)",
        preview: m.intro || "",
        receivedAt: m.createdAt || new Date().toISOString()
      }))
    };
  }

  if (provider === "tempmail") {
    const r = await requestTempMailOrg("/messages", "GET", token);
    const list = Array.isArray(r.json?.messages) ? r.json.messages : [];
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

  if (provider === "mailtm") {
    const res = await fastFetch(`${TM_FAMILY_API}/messages`, { headers: { Authorization: `Bearer ${token}` } }, 4500);
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
    const [login, dom] = (email || "").includes("@") ? email.split("@") : (token || "").split("|");
    const res = await fastFetch(`https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(dom)}`, {}, 4500);
    const list = Array.isArray(res.json) ? res.json : [];
    return {
      status: res.ok,
      messages: list.map((m) => ({
        id: String(m.id),
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        preview: `Masuk pada ${m.date}`,
        receivedAt: m.date
      }))
    };
  }

  if (provider === "guerrilla") {
    const res = await fastFetch(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(token)}`, {}, 4500);
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

  return { status: true, messages: [] };
}

async function handleRead(email, token, provider, id) {
  if (provider === "mailgw") {
    const res = await gwRequest("GET", `/messages/${id}`, { token });
    const r = res.result || {};
    return {
      status: res.status,
      message: {
        id: r.id,
        from: r.from?.address ?? r.from ?? "Unknown",
        subject: r.subject || "(Tanpa Subjek)",
        text: r.text || "",
        html: Array.isArray(r.html) ? r.html.join("\n") : (r.html || `<pre>${r.text || ""}</pre>`)
      }
    };
  }

  if (provider === "tempmail") {
    const r = await requestTempMailOrg(`/messages/${encodeURIComponent(id)}`, "GET", token);
    const d = r.json || {};
    return {
      status: r.ok,
      message: { id: d._id, from: d.from, subject: d.subject || "(Tanpa Subjek)", text: d.bodyPreview || "", html: d.bodyHtml || `<pre>${d.bodyPreview || ""}</pre>` }
    };
  }

  if (provider === "mailtm") {
    const res = await fastFetch(`${TM_FAMILY_API}/messages/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }, 4500);
    const m = res.json || {};
    const htmlBody = Array.isArray(m.html) ? m.html.join("") : (m.html || `<pre>${m.text || ""}</pre>`);
    return { status: res.ok, message: { id: m.id, from: m.from?.address || "Unknown", subject: m.subject || "(Tanpa Subjek)", text: m.text || "", html: htmlBody } };
  }

  if (provider === "1secmail") {
    const [login, dom] = email.split("@");
    const res = await fastFetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(dom)}&id=${encodeURIComponent(id)}`, {}, 4500);
    const m = res.json || {};
    return { status: res.ok, message: { id: String(m.id), from: m.from, subject: m.subject || "(Tanpa Subjek)", text: m.textBody || "", html: m.htmlBody || `<pre>${m.textBody || ""}</pre>` } };
  }

  if (provider === "guerrilla") {
    const res = await fastFetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(id)}&sid_token=${encodeURIComponent(token)}`, {}, 4500);
    const m = res.json || {};
    return { status: res.ok, message: { id: String(m.mail_id), from: m.mail_from, subject: m.mail_subject || "(Tanpa Subjek)", text: m.mail_body || "", html: m.mail_body || "" } };
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
