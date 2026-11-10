from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import re
from datetime import datetime
import zlib
import base64

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def deep_extract_and_decode(data: bytes) -> str:
    """Melakukan ekstraksi mendalam termasuk biner mentah, XOR brute-force, base64, dan dekompresi zlib"""
    collected_texts = []
    
    # 1. Dekode teks standar & ASCII berukuran minimal 4 karakter
    try:
        raw_text = data.decode('utf-8', errors='ignore')
        collected_texts.append(raw_text)
    except:
        pass
        
    printable = re.findall(r'[a-zA-Z0-9_:\/\.\?\=\-\&#%\+]{4,}', collected_texts[0] if collected_texts else "")
    collected_texts.append("\n".join(printable))

    # 2. XOR Brute-force (Key 1 hingga 255) untuk membongkar string terenkripsi XOR sederhana
    for key in range(1, 256):
        try:
            xored = bytes([b ^ key for b in data])
            xored_str = xored.decode('utf-8', errors='ignore')
            # Ambil potongan yang mengandung indikator penting agar tidak terlalu penuh
            if any(k in xored_str.lower() for k in ["discord", "webhook", "http", "socket", "tele", "chat", "key"]):
                collected_texts.append(xored_str)
        except:
            continue

    # 3. Coba cari pola Base64 yang mungkin disembunyikan
    base64_candidates = re.findall(rb'[a-zA-Z0-9+/]{20,}={0,2}', data)
    for b64 in base64_candidates:
        try:
            decoded_b64 = base64.b64decode(b64).decode('utf-8', errors='ignore')
            if len(decoded_b64) > 3:
                collected_texts.append(decoded_b64)
        except:
            continue

    # 4. Coba dekompresi zlib jika terkompresi
    try:
        decompressed = zlib.decompress(data)
        collected_texts.append(decompressed.decode('utf-8', errors='ignore'))
    except:
        pass

    return "\n".join(collected_texts)

@app.post("/api/analyze")
async def analyze_file(file: UploadFile = File(...)):
    contents = await file.read()
    
    # Deteksi jenis bytecode / proteksi
    is_luajit = contents.startswith(b'\x1bLJ') or b'LuaJIT' in contents
    is_lua_compiled = contents.startswith(b'\x1bLua')
    
    # Ekstraksi seluruh teks mendalam
    full_text_pool = deep_extract_and_decode(contents)
    
    patterns_found = []
    
    # 1. Deteksi Webhook Discord / Telegram secara agresif
    webhook_regex = r'(https?://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/[^\s"'`\\]+|https?://api\.telegram\.org/bot[^\s"'`\\]+)'
    webhooks = list(set(re.findall(webhook_regex, full_text_pool, re.IGNORECASE)))
    
    for url in webhooks:
        patterns_found.append({
            "type": "webhook",
            "message": f"🚨 <b>Webhook Berbahaya Ditemukan!</b> Link Target: <a href='{url}' target='_blank' rel='noopener'>{url}</a>"
        })

    # 2. Deteksi URL/Domain Eksternal Mencurigakan Lainnya
    url_regex = r'https?://[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(?:/[^\s"'`\\]*)?'
    found_urls = list(set(re.findall(url_regex, full_text_pool)))
    for u in found_urls:
        if not any(safe in u.lower() for safe in ["discord.com", "telegram.org", "lua.org", "github.com", "microsoft.com"]):
            if len(webhooks) == 0 or u not in webhooks[0]:
                patterns_found.append({
                    "type": "external_url",
                    "message": f"🌐 Koneksi/Endpoint Eksternal Mencurigakan: <code>{u}</code>"
                })

    # 3. Deteksi Pustaka Jaringan (Network Libraries)
    net_keywords = ["http.request", "socket.http", "ssl.https", "cjson", "copas", "inet", "requests"]
    for kw in net_keywords:
        if kw.lower() in full_text_pool.lower():
            patterns_found.append({
                "type": "network",
                "message": f"⚠️ Terdeteksi pustaka komunikasi jaringan: <code>{kw}</code>"
            })
            
    # 4. Deteksi Fungsi Penyadapan / Hooking (Keylogger Indicators)
    hook_keywords = ["onSendChat", "sampev.onSendChat", "onSendDialogResponse", "onKeyDown", "onKeyUp", "getClipboardText", "textinput", "Password", "token"]
    for kw in hook_keywords:
        if kw.lower() in full_text_pool.lower():
            patterns_found.append({
                "type": "hook",
                "message": f"🔍 Terdeteksi fungsi penyadapan input/chat/data sensitif: <code>{kw}</code>"
            })

    # Jika file terenkripsi berat dan tidak ada pola tertangkap
    if (is_luajit or is_lua_compiled) and len(patterns_found) == 0:
        patterns_found.append({
            "type": "warning",
            "message": "🔒 File menggunakan Bytecode LuaJIT / Loader Terproteksi. Struktur internal terkunci rapat oleh loader (seperti weArDevs). Disarankan melakukan Memory Dump saat game berjalan."
        elif len(patterns_found) == 0:
            patterns_found.append({
                "type": "safe",
                "message": "✅ Tidak ditemukan indikator webhook atau fungsi keylogger standar pada file ini."
            })

    return {
        "filename": file.filename,
        "size_kb": round(len(contents) / 1024, 2),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "is_bytecode": is_luajit or is_lua_compiled,
        "patterns": patterns_found
    }
