// Noxis Tmp Mail Unified Multi-Provider API (Vercel Serverless Function)
// Menggabungkan base temp-mail.org (CycleTLS) + Mail.tm + 1secmail untuk custom name & multi-domain nyata

const JA3 = "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

// Helper fetch dengan timeout
async function safeFetch(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    clearTimeout(id);
    return { ok: false, status: 0, error: err.message };
  }
}

// 1. Ambil daftar domain aktif dari berbagai provider nyata
async function getAvailableDomains() {
  const domains = [
    { domain: "temp-mail.org (Auto Random)", provider: "tempmail", tag: "VIP" }
  ];

  // Fetch domain nyata dari Mail.tm
  const mt = await safeFetch("https://api.mail.tm/domains");
  if (mt.ok && Array.isArray(mt.json?.["hydra:member"])) {
    for (const d of mt.json["hydra:member"]) {
      if (d.isActive) {
        domains.push({ domain: d.domain, provider: "mailtm", tag: "CUSTOM" });
      }
    }
  }

  // Fetch domain nyata dari 1secmail (.com, .org, .net, .ru, dll)
  const osm = await safeFetch("https://www.1secmail.com/api/v1/?action=getDomainList");
  if (osm.ok && Array.isArray(osm.json)) {
    for (const d of osm.json) {
      domains.push({ domain: d, provider: "1secmail", tag: "FAST" });
    }
  }

  // Domain populer dari GuerrillaMail (.org, .net, .com, dll)
  const gmDomains = ["guerrillamail.com", "guerrillamail.org", "guerrillamail.net", "sharklasers.com", "grr.la", "pokemail.net"];
  for (const d of gmDomains) {
    domains.push({ domain: d, provider: "guerrilla", tag: "SPA" });
  }

  return domains;
}

// 2. Generate Email (Mendukung Custom Username + Pilihan Domain)
async function handleGenerate(username, domain, provider) {
  const cleanUser = (username || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24) || `noxis${Math.random().toString(36).substring(2, 8)}`;

  // Provider A: Base CycleTLS temp-mail.org
  if (provider === "tempmail" || !domain || domain.includes("temp-mail.org")) {
    try {
      const { default: initCycleTLS } = await import("cycletls");
      const client = await initCycleTLS();
      const res = await client(
        "https://web2.temp-mail.org/mailbox",
        {
          ja3: JA3,
          userAgent: UA,
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            origin: "https://temp-mail.org",
            referer: "https://temp-mail.org/"
          },
          body: JSON.stringify({})
        },
        "post"
      );
      const data = JSON.parse(await res.text());
      await client.exit();
      if (data?.mailbox && data?.token) {
        return {
          status: true,
          email: data.mailbox,
          token: data.token,
          provider: "tempmail"
        };
      }
    } catch (e) {
      // Fallback otomatis ke Mail.tm jika Vercel serverless memblokir binary Go CycleTLS
      provider = "mailtm";
    }
  }

  // Provider B: Mail.tm (Support Custom Name + Token JWT + Full HTML/SPA Inbox)
  if (provider === "mailtm") {
    let targetDomain = domain;
    if (!targetDomain || targetDomain.includes("temp-mail.org")) {
      const dRes = await safeFetch("https://api.mail.tm/domains");
      targetDomain = dRes.json?.["hydra:member"]?.[0]?.domain || "somoj.com";
    }
    const email = `${cleanUser}@${targetDomain}`;
    const password = `Noxis#${Math.random().toString(36).slice(2, 10)}99`;

    const createRes = await safeFetch("https://api.mail.tm/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: email, password })
    });

    if (!createRes.ok) {
      // Jika username sudah dipakai, tambahkan angka acak
      const retryEmail = `${cleanUser}${Math.floor(100 + Math.random() * 899)}@${targetDomain}`;
      const retryRes = await safeFetch("https://api.mail.tm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: retryEmail, password })
      });
      if (!retryRes.ok) {
        return { status: false, error: retryRes.json?.["hydra:description"] || "Gagal membuat akun Mail.tm" };
      }
      const tokenRes = await safeFetch("https://api.mail.tm/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: retryEmail, password })
      });
      return {
        status: true,
        email: retryEmail,
        token: tokenRes.json?.token,
        provider: "mailtm"
      };
    }

    const tokenRes = await safeFetch("https://api.mail.tm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: email, password })
    });

    return {
      status: true,
      email,
      token: tokenRes.json?.token,
      provider: "mailtm"
    };
  }

  // Provider C: 1secmail (Support Custom Name + .com, .org, .net, .ru, dll)
  if (provider === "1secmail") {
    const email = `${cleanUser}@${domain}`;
    return {
      status: true,
      email,
      token: `${cleanUser}|${domain}`,
      provider: "1secmail"
    };
  }

  // Provider D: GuerrillaMail (Support Custom Name + .org, .net, .com)
  if (provider === "guerrilla") {
    const initRes = await safeFetch("https://api.guerrillamail.com/ajax.php?f=get_email_address");
    const sid = initRes.json?.sid_token;
    if (!sid) return { status: false, error: "Gagal inisialisasi sesi GuerrillaMail" };
    const setRes = await safeFetch(
      `https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(cleanUser)}&lang=en&sid_token=${encodeURIComponent(sid)}`
    );
    const actualUser = setRes.json?.email_user || cleanUser;
    return {
      status: true,
      email: `${actualUser}@${domain}`,
      token: sid,
      provider: "guerrilla"
    };
  }

  return { status: false, error: "Provider tidak dikenali" };
}

// 3. Cek Daftar Inbox
async function handleInbox(email, token, provider) {
  if (provider === "tempmail") {
    try {
      const { default: initCycleTLS } = await import("cycletls");
      const client = await initCycleTLS();
      const res = await client(
        "https://web2.temp-mail.org/messages",
        {
          ja3: JA3,
          userAgent: UA,
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            origin: "https://temp-mail.org",
            referer: "https://temp-mail.org/"
          }
        },
        "get"
      );
      const data = JSON.parse(await res.text());
      await client.exit();
      const list = Array.isArray(data?.messages) ? data.messages : [];
      return {
        status: true,
        messages: list.map((m) => ({
          id: m._id,
          from: m.from,
          subject: m.subject || "(Tanpa Subjek)",
          preview: m.bodyPreview || "",
          receivedAt: m.receivedAt ? new Date(m.receivedAt * 1000).toISOString() : new Date().toISOString()
        }))
      };
    } catch (e) {
      return { status: false, error: e.message, messages: [] };
    }
  }

  if (provider === "mailtm") {
    const res = await safeFetch("https://api.mail.tm/messages", {
      headers: { Authorization: `Bearer ${token}` }
    });
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
    const [login, domain] = (token || email || "").split("@").length === 2
      ? email.split("@")
      : (token || "").split("|");
    const res = await safeFetch(
      `https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`
    );
    const list = Array.isArray(res.json) ? res.json : [];
    return {
      status: res.ok,
      messages: list.map((m) => ({
        id: String(m.id),
        from: m.from,
        subject: m.subject || "(Tanpa Subjek)",
        preview: `Pesan masuk pada ${m.date}`,
        receivedAt: m.date
      }))
    };
  }

  if (provider === "guerrilla") {
    const res = await safeFetch(
      `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(token)}`
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

// 4. Baca Isi Lengkap Email (Support HTML SPA, Link Verifikasi, & Plain Text)
async function handleRead(email, token, provider, id) {
  if (provider === "tempmail") {
    const { default: initCycleTLS } = await import("cycletls");
    const client = await initCycleTLS();
    const res = await client(
      `https://web2.temp-mail.org/messages/${id}`,
      {
        ja3: JA3,
        userAgent: UA,
        headers: {
          accept: "application/json, text/plain, */*",
          authorization: `Bearer ${token}`,
          origin: "https://temp-mail.org",
          referer: "https://temp-mail.org/"
        }
      },
      "get"
    );
    const data = JSON.parse(await res.text());
    await client.exit();
    return {
      status: true,
      message: {
        id: data._id,
        from: data.from,
        subject: data.subject || "(Tanpa Subjek)",
        text: data.bodyPreview || "",
        html: data.bodyHtml || `<pre>${data.bodyPreview || ""}</pre>`,
        createdAt: data.createdAt
      }
    };
  }

  if (provider === "mailtm") {
    const res = await safeFetch(`https://api.mail.tm/messages/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const m = res.json || {};
    const htmlContent = Array.isArray(m.html) ? m.html.join("") : (m.html || `<pre>${m.text || ""}</pre>`);
    return {
      status: res.ok,
      message: {
        id: m.id,
        from: m.from?.address || "Unknown",
        subject: m.subject || "(Tanpa Subjek)",
        text: m.text || "",
        html: htmlContent,
        createdAt: m.createdAt
      }
    };
  }

  if (provider === "1secmail") {
    const [login, domain] = email.split("@");
    const res = await safeFetch(
      `https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`
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
    const res = await safeFetch(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(id)}&sid_token=${encodeURIComponent(token)}`
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
      const domains = await getAvailableDomains();
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
