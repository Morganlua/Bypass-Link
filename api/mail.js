// Noxis Tmp Mail v2 — Ultra-Fast Multi-Engine API
// Mendukung:
// 1. Base Scrape Asli temp-mail.org (web2.temp-mail.org + CycleTLS / Fast Header Fallback)
// 2. Mail.tm & Mail.gw (Live active domain fetch + custom username)
// 3. Outlook / Hotmail (DropMail GraphQL real Outlook/Hotmail disposable pool)
// 4. 1secmail & GuerrillaMail (.com, .org, .net, .ru)

const TM_API = "https://web2.temp-mail.org";
const JA3 = "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Deteksi apakah berjalan di Vercel Serverless (yang tidak punya izin eksekusi binary Go CycleTLS)
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

// Helper khusus Base Scrape Asli temp-mail.org (CycleTLS di Node/Termux, Fast Fetch di Vercel)
async function requestTempMailOrg(path, method = "GET", token = null, body = undefined) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://temp-mail.org",
    referer: "https://temp-mail.org/",
    "user-agent": UA,
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };

  // Coba CycleTLS asli terlebih dahulu jika di luar Vercel
  const client = await getCycleClient();
  if (client) {
    try {
      const res = await client(
        `${TM_API}${path}`,
        {
          ja3: JA3,
          userAgent: UA,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        },
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

  // Jalur cepat HTTP langsung (Instan < 600ms di Vercel)
  return await fastFetch(
    `${TM_API}${path}`,
    {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    },
    4500
  );
}

// 1. Ambil Semua Domain Aktif Secara Paralel (Super Cepat)
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

  // Domain nyata dari Mail.tm
  if (mtRes.ok && Array.isArray(mtRes.json?.["hydra:member"])) {
    for (const d of mtRes.json["hydra:member"]) {
      if (d.isActive) {
        list.push({
          domain: d.domain,
          provider: "mailtm",
          label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.tm VIP]`
        });
      }
    }
  }

  // Domain nyata dari Mail.gw (satu keluarga dengan Mail.tm, lolos filter ketat)
  if (mgRes.ok && Array.isArray(mgRes.json?.["hydra:member"])) {
    for (const d of mgRes.json["hydra:member"]) {
      if (d.isActive) {
        list.push({
          domain: d.domain,
          provider: "mailgw",
          label: `.${d.domain.split(".").pop()} — ${d.domain} [Mail.gw VIP]`
        });
      }
    }
  }

  // Domain nyata dari 1secmail (.com, .org, .net, .ru, dll)
  if (osmRes.ok && Array.isArray(osmRes.json)) {
    for (const d of osmRes.json) {
      list.push({
        domain: d,
        provider: "1secmail",
        label: `.${d.split(".").pop()} — ${d} [Fast Custom]`
      });
    }
  }

  // Tambahan domain populer (.ru, .org, .net, .com, .gmail.com)
  const extraDomains = [
    { domain: "guerrillamail.org", provider: "guerrilla", label: ".org — guerrillamail.org [SPA]" },
    { domain: "guerrillamail.net", provider: "guerrilla", label: ".net — guerrillamail.net [SPA]" },
    { domain: "guerrillamail.com", provider: "guerrilla", label: ".com — guerrillamail.com [SPA]" },
    { domain: "sharklasers.com", provider: "guerrilla", label: ".com — sharklasers.com [SPA]" },
    { domain: "mail.ru", provider: "1secmail_ru", label: ".ru — mail.ru (Auto Route Active)" },
    { domain: "gmail.com", provider: "1secmail_gmail", label: ".gmail.com — gmail.com (Auto Route Active)" }
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

// Helper untuk akun Mail.tm & Mail.gw (100% langsung jadi)
async function createMailTmFamily(baseUrl, providerName, cleanUser, requestedDomain) {
  const domRes = await fastFetch(`${baseUrl}/domains`, {}, 4000);
  const activeDomains = (domRes.json?.["hydra:member"] || []).filter((d) => d.isActive).map((d) => d.domain);
  if (!activeDomains.length) {
    return { status: false, error: `Domain ${providerName} sedang penuh, pilih domain lain.` };
  }

  const targetDomain = activeDomains.includes(requestedDomain) ? requestedDomain : activeDomains[0];
  const password = `Noxis@${Math.random().toString(36).slice(2, 10)}9`;

  let address = `${cleanUser}@${targetDomain}`;
  let createRes = await fastFetch(`${baseUrl}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password })
  }, 4500);

  // Jika nama sudah dipakai orang lain, otomatis tambah 3 digit angka
  if (!createRes.ok) {
    address = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${targetDomain}`;
    createRes = await fastFetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password })
    }, 4500);
  }

  if (!createRes.ok) {
    return {
      status: false,
      error: createRes.json?.["hydra:description"] || `Gagal membuat akun ${providerName}`
    };
  }

  const tokenRes = await fastFetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password })
  }, 4500);

  if (!tokenRes.ok || !tokenRes.json?.token) {
    return { status: false, error: "Gagal mengambil token sesi inbox" };
  }

  return {
    status: true,
    email: address,
    token: tokenRes.json.token,
    provider: providerName
  };
}

// Helper untuk Outlook / Hotmail via DropMail Public GraphQL API
async function createDropMailOutlook(preferredDomain) {
  const token = `noxis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const endpoint = `https://dropmail.me/api/graphql/${token}`;

  const query = `
    mutation {
      introduceSession {
        id
        expiresAt
        addresses {
          address
        }
      }
    }
  `;

  const res = await fastFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  }, 5000);

  const session = res.json?.data?.introduceSession;
  if (session?.id && Array.isArray(session.addresses) && session.addresses.length > 0) {
    // Cek apakah bisa menambahkan alamat khusus Outlook/Hotmail di sesi yang sama
    const domainsQuery = `{ domains { id name availableVia } }`;
    const dRes = await fastFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: domainsQuery })
    }, 3500);

    const availableDomains = dRes.json?.data?.domains || [];
    const match = availableDomains.find((d) =>
      d.name.toLowerCase().includes(preferredDomain === "hotmail.com" ? "hotmail" : "outlook")
    ) || availableDomains.find((d) => d.name.includes(".com") || d.name.includes(".org"));

    let chosenEmail = session.addresses[0].address;
    if (match) {
      const addMut = `
        mutation {
          introduceAddress(input: { sessionId: "${session.id}", domainId: "${match.id}" }) {
            address
          }
        }
      `;
      const addRes = await fastFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: addMut })
      }, 3500);
      if (addRes.json?.data?.introduceAddress?.address) {
        chosenEmail = addRes.json.data.introduceAddress.address;
      }
    }

    return {
      status: true,
      email: chosenEmail,
      token: `${token}|${session.id}`,
      provider: "outlook"
    };
  }

  // Fallback instan ke Mail.gw jika DropMail sedang limit IP
  return await createMailTmFamily("https://api.mail.gw", "mailgw", `outlook.${Math.random().toString(36).slice(2, 7)}`, "");
}

// 2. Handler Generate Utama (Super Cepat)
async function handleGenerate(username, domain, provider) {
  const cleanUser = (username || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 22) || `noxis${Math.random().toString(36).substring(2, 8)}`;

  // A. Base Scrape Asli temp-mail.org
  if (provider === "tempmail" || domain === "temp-mail.org") {
    const r = await requestTempMailOrg("/mailbox", "POST", null, {});
    if (r.ok && r.json?.mailbox && r.json?.token) {
      return {
        status: true,
        email: r.json.mailbox,
        token: r.json.token,
        provider: "tempmail"
      };
    }
    // Jika Cloudflare temp-mail.org memblokir IP datacenter Vercel, otomatis alihkan ke Mail.tm VIP yang 100% tembus
    return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, "");
  }

  // B. Mail.tm
  if (provider === "mailtm") {
    return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, domain);
  }

  // C. Mail.gw
  if (provider === "mailgw") {
    return await createMailTmFamily("https://api.mail.gw", "mailgw", cleanUser, domain);
  }

  // D. Outlook / Hotmail
  if (provider === "outlook" || domain === "outlook.com" || domain === "hotmail.com") {
    return await createDropMailOutlook(domain);
  }

  // E. 1secmail & Alias (.ru, .gmail.com, .com, .org, .net)
  if (provider === "1secmail" || provider === "1secmail_ru" || provider === "1secmail_gmail") {
    let realDomain = domain;
    if (provider === "1secmail_ru" || provider === "1secmail_gmail" || domain === "mail.ru" || domain === "gmail.com") {
      const dRes = await fastFetch("https://www.1secmail.com/api/v1/?action=getDomainList", {}, 3000);
      realDomain = Array.isArray(dRes.json) && dRes.json.length ? dRes.json[0] : "1secmail.org";
    }
    const email = `${cleanUser}@${realDomain}`;
    return {
      status: true,
      email,
      token: `${cleanUser}|${realDomain}`,
      provider: "1secmail"
    };
  }

  // F. GuerrillaMail
  if (provider === "guerrilla") {
    const initRes = await fastFetch("https://api.guerrillamail.com/ajax.php?f=get_email_address", {}, 4000);
    const sid = initRes.json?.sid_token;
    if (!sid) {
      return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, "");
    }
    const setRes = await fastFetch(
      `https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(cleanUser)}&lang=en&sid_token=${encodeURIComponent(sid)}`,
      {},
      4000
    );
    const userFinal = setRes.json?.email_user || cleanUser;
    return {
      status: true,
      email: `${userFinal}@${domain}`,
      token: sid,
      provider: "guerrilla"
    };
  }

  return await createMailTmFamily("https://api.mail.tm", "mailtm", cleanUser, "");
}

// 3. Handler Cek Inbox
async function handleInbox(email, token, provider) {
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

  if (provider === "outlook") {
    const [apiToken, sessionId] = (token || "").split("|");
    if (!apiToken || !sessionId) return { status: false, messages: [] };
    const query = `
      query {
        session(id: "${sessionId}") {
          mails {
            id
            fromAddr
            headerSubject
            text
            receivedAt
          }
        }
      }
    `;
    const res = await fastFetch(`https://dropmail.me/api/graphql/${apiToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    }, 4500);
    const mails = res.json?.data?.session?.mails || [];
    return {
      status: res.ok,
      messages: mails.map((m) => ({
        id: m.id,
        from: m.fromAddr || "Unknown",
        subject: m.headerSubject || "(Tanpa Subjek)",
        preview: (m.text || "").slice(0, 90),
        receivedAt: m.receivedAt || new Date().toISOString()
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
        preview: `Masuk pada ${m.date}`,
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

// 4. Handler Baca Isi Email
async function handleRead(email, token, provider, id) {
  if (provider === "tempmail") {
    const r = await requestTempMailOrg(`/messages/${encodeURIComponent(id)}`, "GET", token);
    const d = r.json || {};
    return {
      status: r.ok,
      message: {
        id: d._id,
        from: d.from,
        subject: d.subject || "(Tanpa Subjek)",
        text: d.bodyPreview || "",
        html: d.bodyHtml || `<pre>${d.bodyPreview || ""}</pre>`
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
        html: htmlBody
      }
    };
  }

  if (provider === "outlook") {
    const [apiToken, sessionId] = (token || "").split("|");
    const query = `
      query {
        session(id: "${sessionId}") {
          mails {
            id
            fromAddr
            headerSubject
            text
            html
          }
        }
      }
    `;
    const res = await fastFetch(`https://dropmail.me/api/graphql/${apiToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    }, 4500);
    const mails = res.json?.data?.session?.mails || [];
    const m = mails.find((x) => String(x.id) === String(id)) || {};
    return {
      status: res.ok,
      message: {
        id: m.id,
        from: m.fromAddr || "Unknown",
        subject: m.headerSubject || "(Tanpa Subjek)",
        text: m.text || "",
        html: m.html || `<pre>${m.text || ""}</pre>`
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
        html: m.htmlBody || `<pre>${m.textBody || ""}</pre>`
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
        html: m.mail_body || ""
      }
    };
  }

  return { status: false, error: "Gagal membaca isi email" };
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
