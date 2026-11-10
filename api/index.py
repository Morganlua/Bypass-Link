from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import re
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def deobfuscate_strings(data: bytes) -> str:
    """Ekstraksi string dari biner/bytecode dan coba dekripsi XOR sederhana"""
    text_content = data.decode('utf-8', errors='ignore')
    
    # Ekstraksiprintable ASCII strings dari binary data
    printable_strings = re.findall(r'[a-zA-Z0-9_:\/\.\?\=\%\-\&\#]{6,}', text_content)
    combined_text = text_content + "
" + "
".join(printable_strings)
    
    # Coba XOR brute-force key 1 byte (1-255) untuk mencari string tersembunyi
    xor_extracted = []
    for key in range(1, 256):
        decoded = bytes([b ^ key for b in data])
        decoded_str = decoded.decode('utf-8', errors='ignore')
        if "discord.com/api/webhooks" in decoded_str or "api.telegram.org" in decoded_str:
            xor_extracted.append(decoded_str)
            
    return combined_text + "
" + "
".join(xor_extracted)

@app.post("/api/analyze")
async def analyze_file(file: UploadFile = File(...)):
    contents = await file.read()
    
    # Periksa Header Bytecode LuaJIT / Lua Standar
    is_luajit = contents.startswith(b'LJ') or b'LuaJIT' in contents
    is_lua_compiled = contents.startswith(b'Lua')
    
    extracted_text = deobfuscate_strings(contents)
    
    patterns_found = []
    
    # 1. Deteksi Webhook Discord / Telegram
    webhook_regex = r'(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'`\]+|https?:\/\/api\.telegram\.org\/bot[^\s"'`\]+)'
    webhooks = list(set(re.findall(webhook_regex, extracted_text)))
    
    for url in webhooks:
        patterns_found.append({
            "type": "webhook",
            "message": f"Terdeteksi Link Webhook: <a href='{url}' target='_blank' rel='noopener'>{url}</a>"
        })
        
    # 2. Deteksi Network Library & Hooking Input (Keylogger Indicator)
    net_keywords = ["http.request", "socket.http", "ssl.https", "cjson", "copas"]
    for kw in net_keywords:
        if kw in extracted_text:
            patterns_found.append({
                "type": "network",
                "message": f"Terdeteksi pustaka pengiriman data eksternal/jaringan: <code>{kw}</code>"
            })
            
    hook_keywords = ["onSendChat", "sampev.onSendChat", "onSendDialogResponse", "onKeyDown", "getClipboardText"]
    for kw in hook_keywords:
        if kw in extracted_text:
            patterns_found.append({
                "type": "hook",
                "message": f"Terdeteksi fungsi penyadapan input/chat (Hooking): <code>{kw}</code>"
            })

    # Jika file terenkripsi berat tanpa string yang lolos
    if (is_luajit or is_lua_compiled) and len(patterns_found) == 0:
        patterns_found.append({
            "type": "warning",
            "message": "File merupakan Bytecode LuaJIT terenkripsi rapat. Disarankan ekstraksi memory dump saat runtime."
        })

    return {
        "filename": file.filename,
        "size_kb": round(len(contents) / 1024, 2),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "is_bytecode": is_luajit or is_lua_compiled,
        "patterns": patterns_found
    }
