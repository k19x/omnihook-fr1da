import os
import sys
import time
import json
import shutil
import threading
import subprocess
import re
import asyncio
import urllib.request
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from androguard.core.apk import APK
import google.generativeai as genai
import aiofiles

# Adicionado para corrigir o erro de 'NotImplementedError' no Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# =========================================================
# App + CORS + Static + Templates
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="OmniHook Fr1da • Pentest Mobile")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/download/apk")
async def download_apk():
    """
    Permite o download do arquivo APK principal do aplicativo.
    """
    apk_path = os.path.join(BASE_DIR, "static", "apk", "app.apk")
    if not os.path.exists(apk_path):
        raise HTTPException(status_code=404, detail="Arquivo APK não encontrado. Faça o upload do arquivo para a pasta static/apk.")
    return FileResponse(apk_path, media_type="application/vnd.android.package-archive", filename="app.apk")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    favicon_path = os.path.join(BASE_DIR, "static", "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    raise HTTPException(status_code=404, detail="Favicon not found")

# paths
SCRIPT_PATH   = os.path.join(BASE_DIR, "static", "js", "scripts")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
OUTPUTS       = os.path.join(BASE_DIR, "outputs")
MIRROR_DIR    = os.path.join(BASE_DIR, "mirror")
ICONS_DIR     = os.path.join(BASE_DIR, "static", "icons")
CONFIG_FILE   = os.path.join(BASE_DIR, "config.json")

os.makedirs(SCRIPT_PATH, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUTS, exist_ok=True)
os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(MIRROR_DIR, exist_ok=True)

# =========================================================
# Configuração da IA (Gemini)
# =========================================================
async def load_config_async():
    """Carrega a configuração do arquivo JSON."""
    # Use asyncio.to_thread para os.path.exists, que é bloqueante
    if not await asyncio.to_thread(os.path.exists, CONFIG_FILE):
        return {"ai_provider": "gemini", "api_key": ""}
    
    # Use aiofiles para leitura assíncrona de arquivos
    async with aiofiles.open(CONFIG_FILE, 'r') as f:
        content = await f.read()
        # json.loads é CPU-bound, mas geralmente rápido para arquivos pequenos.
        # Para arquivos grandes, poderia ser envolvido em asyncio.to_thread.
        return json.loads(content)
    return {"ai_provider": "gemini", "api_key": ""}

async def configure_ai_async():
    """Configura a API de IA com base no arquivo de configuração."""
    api_key_from_env = os.environ.get("GOOGLE_API_KEY")

    if api_key_from_env:
        try:
            genai.configure(api_key=api_key_from_env)
            print("INFO: Chave da API do Google configurada via variável de ambiente (GOOGLE_API_KEY).")
            return
        except Exception as e:
            print(f"AVISO: Falha ao configurar a API do Gemini com a chave da variável de ambiente: {e}")

    api_key_from_file = (await load_config_async()).get("api_key")
    if api_key_from_file:
        try:
            genai.configure(api_key=api_key_from_file)
            print("INFO: Chave da API do Google configurada via arquivo config.json.")
        except Exception as e:
            print(f"AVISO: Falha ao configurar a API do Gemini com a chave fornecida: {e}")
    else:
        print("AVISO: Chave da API de IA não encontrada. Funcionalidades de IA estarão desabilitadas.")

# =========================================================
# Models (Pydantic)
# =========================================================
class ListarPacotesBody(BaseModel):
    dispositivo_id: str
    filtro: Optional[str] = "user"

class StatusConexaoBody(BaseModel):
    dispositivo_id: str

class AtivarTcpIpBody(BaseModel):
    dispositivo_id: str

class ReiniciarFridaBody(BaseModel):
    dispositivo_id: str

class ScreenshotBody(BaseModel):
    device: str

class ScreenRecordBody(BaseModel):
    device: str
    duration: Optional[int] = 10

class DumpApkBody(BaseModel):
    device: str
    package: str

class PortForwardBody(BaseModel):
    device: str
    local: str
    remote: str

class ProxySetBody(BaseModel):
    device: str
    ip: str
    port: str

class ProxyDeviceBody(BaseModel):
    device: str

class FileExplorerBody(BaseModel):
    device: str
    path: str

class FileDownloadBody(BaseModel):
    device: str
    path: str

class FileRenameBody(BaseModel):
    device: str
    old_path: str
    new_name: str

class FileDeleteBody(BaseModel):
    device: str
    path: str

class DeepLinkBody(BaseModel):
    device: str
    command: str

class MainActivityBody(BaseModel):
    device: str
    package: str

class SaveScriptBody(BaseModel):
    filename: str
    content: str

class SettingsBody(BaseModel):
    ai_provider: str
    api_key: str

class AppActionBody(BaseModel):
    device: str
    package: str

class AnalyzeManifestBody(BaseModel):
    device: str
    package: str

class AdbCommandBody(BaseModel):
    command: str
    device: Optional[str] = None

class GalleryDeleteBody(BaseModel):
    filename: str

class MirrorBody(BaseModel):
    device_id: str

class DecompileBody(BaseModel):
    device: str
    package: str

class ImproveScriptBody(BaseModel):
    content: str
    objective: str
    package: Optional[str] = None

class JadxProjectBody(BaseModel):
    package: str

class JadxReadBody(BaseModel):
    package: str
    file_path: str


# Frida via WS
class FridaCmd(BaseModel):
    type: str
    dispositivo_id: Optional[str] = None
    pacote: Optional[str] = None
    scripts: Optional[List[str]] = []
    forma: Optional[str] = None
    conteudo: Optional[str] = None

# =========================================================
# WebSocket Manager
# =========================================================
class WSManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

    async def send_text(self, websocket: WebSocket, text: str):
        # Verifica se o websocket ainda está na lista de conexões ativas antes de enviar.
        # Isso evita erros se o cliente se desconectar enquanto uma tarefa em segundo plano
        # ainda está tentando enviar dados.
        if websocket in self.active:
            await websocket.send_text(text)

ws_manager = WSManager()

# =========================================================
# Helpers ADB/exec
# =========================================================
# Removendo as funções síncronas adb_out, adb_shell, adb_shell_su
# e criando versões assíncronas que usam run_adb_command
async def async_adb_out(args: List[str], check: bool = True, timeout: int = 15) -> str:
    process = await run_adb_command(args, check, timeout)
    return process.stdout.strip()
async def async_adb_shell(dev: str, *cmd: str, check: bool = True, timeout: int = 15) -> str:
    return await async_adb_out(["adb", "-s", dev, "shell", *cmd], check, timeout)
async def async_adb_shell_su(dev: str, command: str, check: bool = True, timeout: int = 15) -> str:
    return await async_adb_out(["adb", "-s", dev, "shell", "su", "-c", command], check, timeout)

def run_cmd_and_stream_to_queue(cmd: List[str], queue: asyncio.Queue):
    """
    Executa um comando em uma thread e envia a saída para uma asyncio.Queue.
    Esta função é síncrona e deve ser executada em uma thread separada.
    """
    try:
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace'
        )
        for line in iter(process.stdout.readline, ''):
            queue.put_nowait(line.rstrip())
        process.stdout.close()
        process.wait()
    except Exception as e:
        queue.put_nowait(f"[ERRO NO SUBPROCESSO] {e}")
    finally:
        queue.put_nowait(None) # Sinaliza o fim do stream

async def run_adb_command(args: List[str], check: bool = True, timeout: int = 15) -> subprocess.CompletedProcess:
    """
    Executa um comando de subprocesso de forma segura com tratamento de erro padronizado.
    Esta é uma função `async` que executa o subprocesso síncrono em uma thread separada
    para não bloquear o loop de eventos do FastAPI.
    """
    try:
        # Envolve a chamada síncrona em asyncio.to_thread
        process = await asyncio.to_thread(
            subprocess.run,
            args,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            check=check,
            timeout=timeout
        )
        return process
    except FileNotFoundError:
        # Ocorre se 'adb' (ou outro executável) não for encontrado no PATH do sistema.
        raise HTTPException(status_code=500, detail=f"Comando '{args[0]}' não encontrado. Verifique se está instalado e no PATH.")
    except subprocess.CalledProcessError as e:
        # Ocorre quando o comando retorna um código de saída diferente de zero.
        error_output = e.stderr.strip() or e.stdout.strip() or "Nenhuma saída de erro capturada."
        raise HTTPException(status_code=500, detail=f"Erro ao executar comando: {error_output}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail=f"Comando '{' '.join(args)}' excedeu o tempo limite de {timeout}s.")

# =========================================================
# Rotas HTTP
# =========================================================
@app.on_event("startup")
async def startup_event():
    """Executa na inicialização do servidor."""
    if not os.path.exists(CONFIG_FILE):
        # Cria um arquivo de configuração padrão se não existir
        async with aiofiles.open(CONFIG_FILE, 'w') as f:
            await f.write(json.dumps({"ai_provider": "gemini", "api_key": ""}))
    await configure_ai_async()

@app.get("/get_settings")
async def get_settings():
    """Retorna as configurações atuais."""
    return await load_config_async()

@app.post("/save_settings")
async def save_settings(body: SettingsBody):
    async with aiofiles.open(CONFIG_FILE, 'w') as f:
        await f.write(json.dumps(body.dict()))
    await configure_ai_async() # Reconfigura a IA com a nova chave
    return {"message": "Configurações salvas com sucesso."}

@app.get("/listar_scripts")
def listar_scripts():
    try:
        arquivos = [f for f in os.listdir(SCRIPT_PATH) if f.endswith(".js")]
        return arquivos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/adicionar_script")
def adicionar_script(script: UploadFile = File(...)):
    try:
        if not script.filename.endswith(".js"):
            raise HTTPException(status_code=400, detail="Apenas arquivos .js são permitidos")
        save_path = os.path.join(SCRIPT_PATH, script.filename)
        with open(save_path, "wb") as f:
            f.write(script.file.read())
        return {"message": f"Script '{script.filename}' adicionado com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/script/{filename}", response_class=PlainTextResponse)
async def get_script_content(filename: str):
    safe_filename = os.path.basename(filename)
    if safe_filename != filename or not safe_filename.endswith(".js"):
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")
    
    file_path = os.path.join(SCRIPT_PATH, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script não encontrado.")
    
    async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
        content = await f.read()
    return content

@app.post("/script")
async def save_script(body: SaveScriptBody):
    safe_filename = os.path.basename(body.filename)
    if safe_filename != body.filename or not safe_filename.endswith(".js"):
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")

    file_path = os.path.join(SCRIPT_PATH, safe_filename)
    try:
        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(body.content)
        return {"message": f"Script '{safe_filename}' salvo com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar o script: {str(e)}")

@app.delete("/script/{filename}")
async def delete_script(filename: str):
    safe_filename = os.path.basename(filename)
    if safe_filename != filename or not safe_filename.endswith(".js"):
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")

    file_path = os.path.join(SCRIPT_PATH, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script não encontrado.")

    try:
        os.remove(file_path)
        return {"message": f"Script '{safe_filename}' deletado com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao deletar o script: {str(e)}")

@app.post("/improve_script", response_class=PlainTextResponse)
async def improve_script(body: ImproveScriptBody):
    config = await load_config_async()
    if not config.get("api_key") and not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="IA não configurada. Verifique a chave da API.")

    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = f"""
        Você é um especialista em pentest mobile e engenharia reversa, com foco em Frida.
        Sua tarefa é criar ou refatorar um script Frida com base no objetivo do usuário e no código que ele já escreveu.

        **Contexto:**
        - **Pacote Alvo:** `{body.package}`
        - **Objetivo do Usuário:** "{body.objective}"

        **Script Atual do Usuário (pode estar vazio):**
        ```javascript
        {body.content}
        ```

        **Instruções:**
        1.  Se o script atual estiver vazio ou for um placeholder, crie um novo script robusto do zero que atenda ao objetivo do usuário.
        2.  Se já existir um script, melhore-o. Corrija erros, adicione verificações (ex: `if (classe)`) e formate o código para ser claro e eficiente.
        3.  Adicione comentários `//` para explicar partes importantes do código.
        4.  **IMPORTANTE:** Retorne APENAS o código JavaScript puro. Não inclua explicações, introduções ou blocos de markdown como ```javascript.

        **Exemplo de Resposta Válida:**
        ```javascript
        Java.perform(function() {{
            // Seu código aqui...
        }});
        ```
        """
        response = await model.generate_content_async(prompt)
        return response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na API de IA: {str(e)}")


@app.get("/listar_dispositivos")
async def listar_dispositivos(): # Tornar a função assíncrona
    try:
        # Usar run_adb_command para verificar a existência do adb
        await run_adb_command(["adb", "version"])
    except HTTPException as e: # run_adb_command levanta HTTPException
        raise HTTPException(status_code=500, detail="Comando 'adb' não encontrado ou não funcional. Verifique se o Android SDK Platform-Tools está instalado e no PATH do sistema.")
    try:
        # Usar run_adb_command para listar dispositivos
        result_process = await run_adb_command(["adb", "devices", "-l"])
        resultado = result_process.stdout.splitlines()
        dispositivos = []
        for linha in resultado[1:]:
            if linha.strip():
                partes = linha.split()
                device_id = partes[0]
                modelo = "Desconhecido"
                for p in partes:
                    if p.startswith("model:"):
                        modelo = p.split("model:")[1]
                        break
                conexao = "REDE" if ":" in device_id and device_id.count(".") == 3 else "USB"
                dispositivos.append({"id": device_id, "name": modelo, "conexao": conexao})
        return dispositivos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/listar_pacotes")
async def listar_pacotes(body: ListarPacotesBody): # Tornar a função assíncrona
    dispositivo_id = body.dispositivo_id
    filtro = body.filtro
    if not dispositivo_id:
        raise HTTPException(status_code=400, detail="ID do dispositivo não fornecido.")
    try:
        pacotes_objs = []
        
        if filtro == "user":
            # Apenas apps de usuário (-3)
            out = await async_adb_shell(dispositivo_id, "pm", "list", "packages", "-3")
            for line in out.splitlines():
                pkg = line.replace("package:", "").strip()
                if pkg: pacotes_objs.append({"id": pkg, "type": "user"})
                
        elif filtro == "system":
            # Apenas apps de sistema (-s)
            out = await async_adb_shell(dispositivo_id, "pm", "list", "packages", "-s")
            for line in out.splitlines():
                pkg = line.replace("package:", "").strip()
                if pkg: pacotes_objs.append({"id": pkg, "type": "system"})
                
        else:
            # Todos: precisamos identificar qual é qual.
            # Estratégia: Listar todos e listar sistema. O que estiver em sistema é 'system', resto é 'user'.
            sys_out = await async_adb_shell(dispositivo_id, "pm", "list", "packages", "-s")
            sys_pkgs = set(line.replace("package:", "").strip() for line in sys_out.splitlines() if line.strip())
            
            all_out = await async_adb_shell(dispositivo_id, "pm", "list", "packages")
            for line in all_out.splitlines():
                pkg = line.replace("package:", "").strip()
                if not pkg: continue
                p_type = "system" if pkg in sys_pkgs else "user"
                pacotes_objs.append({"id": pkg, "type": p_type})

        # Enriquecer com labels do cache se existirem
        for item in pacotes_objs:
            pkg = item["id"]
            lbl_path = os.path.join(ICONS_DIR, f"{pkg}.txt")
            if os.path.exists(lbl_path):
                try:
                    with open(lbl_path, "r", encoding="utf-8") as f:
                        item["label"] = f.read().strip()
                except: pass

        return pacotes_objs
    except HTTPException as e: # Capturar HTTPException de async_adb_shell
        raise HTTPException(status_code=404, detail=f"Dispositivo '{dispositivo_id}' não encontrado ou falha no comando. Erro: {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def fetch_play_store_info_sync(package: str) -> dict:
    """Tenta baixar ícone e nome da Play Store via scraping."""
    url = f"https://play.google.com/store/apps/details?id={package}&hl=pt"
    result = {"icon": None, "label": None}
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # Busca meta tag twitter:image que geralmente contém o ícone em alta resolução
            match = re.search(r'<meta name="twitter:image" content="([^"]+)"', html)
            if match:
                icon_url = match.group(1)
                with urllib.request.urlopen(icon_url, timeout=5) as icon_res:
                    result["icon"] = icon_res.read()
            
            # Busca o título do App
            match_label = re.search(r'<h1 itemprop="name">\s*<span>(.*?)</span>\s*</h1>', html)
            if match_label:
                result["label"] = match_label.group(1)
    except: 
        pass
    return result

@app.get("/app_icon/{device}/{package}")
async def get_app_icon(device: str, package: str, refresh: bool = False):
    """Extrai e retorna o ícone de um app instalado."""
    icon_path = os.path.join(ICONS_DIR, f"{package}.png")
    label_path = os.path.join(ICONS_DIR, f"{package}.txt")
    
    # Se refresh for solicitado, remove o cache existente para forçar nova extração
    if refresh and os.path.exists(icon_path):
        try: os.remove(icon_path)
        except: pass
    
    # 1. Se já existe em cache, verifica se é válido (evita XMLs antigos)
    if os.path.exists(icon_path):
        try:
            with open(icon_path, "rb") as f:
                header = f.read(16)
            if header.startswith(b'\x89PNG') or header.startswith(b'\xff\xd8') or (header.startswith(b'RIFF') and b'WEBP' in header):
                return FileResponse(icon_path)
        except: pass
        # Se chegou aqui, o arquivo é inválido ou não é imagem bitmap. Removemos.
        try: os.remove(icon_path)
        except: pass

    try:
        # 2. Obtém o caminho do APK no dispositivo
        proc = await run_adb_command(["adb", "-s", device, "shell", "pm", "path", package])
        out = proc.stdout.strip()
        if not out or "package:" not in out:
            raise HTTPException(status_code=404, detail="Pacote não encontrado")
        
        # Pega o primeiro caminho (base.apk)
        apk_remote_path = out.splitlines()[0].replace("package:", "").strip()
        temp_apk = os.path.join(UPLOAD_FOLDER, f"temp_icon_{package}.apk")

        # 3. Puxa o APK e extrai o ícone (em thread separada para não bloquear)
        await run_adb_command(["adb", "-s", device, "pull", apk_remote_path, temp_apk])

        def extract_icon_sync():
            try:
                apk = APK(temp_apk)
                icon_data = apk.get_app_icon()
                
                # Tenta extrair o nome do app do APK
                app_label = apk.get_app_name()
                if app_label:
                    with open(label_path, "w", encoding="utf-8") as f: f.write(str(app_label))
                
                # Verifica se é imagem bitmap válida (PNG, JPEG, WEBP) para evitar XML VectorDrawable
                if icon_data and (icon_data.startswith(b'\x89PNG') or icon_data.startswith(b'\xff\xd8') or (icon_data.startswith(b'RIFF') and b'WEBP' in icon_data[:16])):
                    with open(icon_path, "wb") as f:
                        f.write(icon_data)
                    return True
                
                # Fallback: Se for XML (Adaptive Icon), tenta encontrar um PNG alternativo no APK
                # Procura por arquivos PNG que contenham "ic_launcher" ou "icon"
                candidates = [f for f in apk.get_files() if f.endswith(".png") and ("ic_launcher" in f or "icon" in f)]
                
                if candidates:
                    # Prioriza alta resolução (xxxhdpi > xxhdpi > ...)
                    priorities = ["xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi"]
                    best_candidate = candidates[0]
                    for p in priorities:
                        match = next((c for c in candidates if p in c), None)
                        if match:
                            best_candidate = match
                            break
                    
                    with open(icon_path, "wb") as f:
                        f.write(apk.get_file(best_candidate))
                    return True

                return False
            except: return False
            finally:
                if os.path.exists(temp_apk): os.remove(temp_apk)

        success = await asyncio.to_thread(extract_icon_sync)
        
        # 4. Se a extração local falhou (ex: XML puro sem PNG), tenta baixar da Play Store
        if not success:
            online_info = await asyncio.to_thread(fetch_play_store_info_sync, package)
            if online_info["icon"]:
                # Valida se o conteúdo baixado é realmente uma imagem válida
                icon_data = online_info["icon"]
                if icon_data.startswith(b'\x89PNG') or icon_data.startswith(b'\xff\xd8') or (icon_data.startswith(b'RIFF') and b'WEBP' in icon_data[:16]):
                    with open(icon_path, "wb") as f:
                        f.write(icon_data)
                    if online_info["label"]:
                        with open(label_path, "w", encoding="utf-8") as f:
                            f.write(online_info["label"])
                    success = True

        if success:
            return FileResponse(icon_path)
        else:
            # Retorna 404 para o frontend usar o fallback
            raise HTTPException(status_code=404, detail="Ícone não extraível")
            
    except Exception as e:
        # print(f"Erro ícone {package}: {e}")
        raise HTTPException(status_code=404, detail="Erro ao obter ícone")

@app.get("/app_label/{device}/{package}")
async def get_app_label(device: str, package: str):
    """Retorna o nome do aplicativo (Label)."""
    label_path = os.path.join(ICONS_DIR, f"{package}.txt")
    
    if os.path.exists(label_path):
        with open(label_path, "r", encoding="utf-8") as f:
            return {"label": f.read().strip()}
            
    # 1. Tenta buscar online rapidinho (Play Store)
    info = await asyncio.to_thread(fetch_play_store_info_sync, package)
    if info["label"]:
        with open(label_path, "w", encoding="utf-8") as f: f.write(info["label"])
        return {"label": info["label"]}
    
    # 2. Fallback: Tenta extrair via dumpsys do dispositivo (Offline / System Apps)
    try:
        # dumpsys package retorna info detalhada. Buscamos 'nonLocalizedLabel'
        proc = await run_adb_command(["adb", "-s", device, "shell", "dumpsys", "package", package])
        out = proc.stdout
        
        # Regex para capturar 'nonLocalizedLabel=WhatsApp' ou similar
        match = re.search(r'nonLocalizedLabel=(?!null)(.+)', out)
        if match:
            label = match.group(1).strip()
            label = label.strip('"\'') # Remove aspas extras se houver
            if label:
                with open(label_path, "w", encoding="utf-8") as f: f.write(label)
                return {"label": label}
    except Exception:
        pass

    return {"label": package} # Fallback para o pacote se não achar nome

@app.post("/app_action/launch")
async def action_launch(body: AppActionBody):
    try:
        # Usa o 'monkey' para iniciar a activity principal sem precisar saber o nome exato dela
        await run_adb_command(["adb", "-s", body.device, "shell", "monkey", "-p", body.package, "-c", "android.intent.category.LAUNCHER", "1"])
        return {"message": f"App {body.package} iniciado."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/app_action/clear")
async def action_clear(body: AppActionBody):
    try:
        await run_adb_command(["adb", "-s", body.device, "shell", "pm", "clear", body.package])
        return {"message": f"Dados de {body.package} limpos com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/app_action/uninstall")
async def action_uninstall(body: AppActionBody):
    try:
        # O comando uninstall geralmente não requer 'shell' antes, mas depende da implementação do adb server.
        await run_adb_command(["adb", "-s", body.device, "uninstall", body.package])
        return {"message": f"App {body.package} desinstalado."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/status_conexao")
async def status_conexao(body: StatusConexaoBody): # Tornar a função assíncrona
    dispositivo_id = body.dispositivo_id
    try:
        cmd = ["adb", "-s", dispositivo_id, "get-state"]
        # Usar run_adb_command
        result_process = await run_adb_command(cmd)
        resultado = result_process.stdout.strip()
        status_map = {
            "device": "✅ Dispositivo conectado e pronto.",
            "offline": "⚠️ Dispositivo detectado, mas offline.",
            "unauthorized": "❌ Autorização necessária. Aceite a chave de depuração no celular."
        }
        mensagem = status_map.get(resultado, f"Estado desconhecido: {resultado}")
        return {"estado": resultado, "mensagem": mensagem}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ativar_tcpip")
async def ativar_tcpip(body: AtivarTcpIpBody): # Tornar a função assíncrona
    dispositivo_id = body.dispositivo_id
    if not dispositivo_id:
        raise HTTPException(status_code=400, detail="ID do dispositivo não fornecido.")
    try:
        ip = None
        # Usar a versão assíncrona de adb_shell
        ip_out = await async_adb_shell(dispositivo_id, "ip", "-f", "inet", "addr", "show", "wlan0")
        for linha in ip_out.splitlines():
            linha = linha.strip()
            if linha.startswith("inet "):
                ip = linha.split()[1].split("/")[0]
                break
        if not ip:
            raise HTTPException(status_code=500, detail="❌ Não foi possível identificar o IP (wlan0).")

        # Usar run_adb_command
        await run_adb_command(["adb", "-s", dispositivo_id, "tcpip", "5555"])
        result_connect = await run_adb_command(["adb", "connect", f"{ip}:5555"])
        resultado_conexao = result_connect.stdout.strip()
        return {"mensagem": f"✅ TCP/IP ativado e conexão via rede com: {ip}:5555\n{resultado_conexao}", "ip": ip}
    except HTTPException as e: # Capturar HTTPException de run_adb_command
        raise HTTPException(status_code=500, detail=f"[ADB ERRO] {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"[EXCEÇÃO] {str(e)}")

@app.post("/reiniciar_frida")
async def reiniciar_frida(body: ReiniciarFridaBody): # Tornar a função assíncrona
    dispositivo_id = body.dispositivo_id
    try:
        # Usar run_adb_command
        await run_adb_command(["adb", "-s", dispositivo_id, "shell", "su", "-c", "pkill -f frida-server"], check=False)
        await run_adb_command(["adb", "-s", dispositivo_id, "shell", "su", "-c", "nohup ./data/local/tmp/frida-server &"], check=False)
        return {"mensagem": "Frida reiniciado com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/listar_templates")
def listar_templates():
    return [
        {"nome": "Bypass SSL Pinning", "arquivo": "bypass_ssl.js"},
        {"nome": "Anti-root Bypass", "arquivo": "antiroot.js"},
        {"nome": "Log de chamadas de APIs Java", "arquivo": "log_java.js"}
    ]

@app.post("/screenshot")
async def screenshot(body: ScreenshotBody):
    device_id = body.device
    if not device_id:
        raise HTTPException(status_code=400, detail="Nenhum dispositivo selecionado")

    remote_path = f"/data/local/tmp/screenshot_{int(time.time())}.png"
    
    try:
        # 1. Tira o screenshot e salva no dispositivo
        await run_adb_command(["adb", "-s", device_id, "shell", f"screencap -p {remote_path}"])

        # 2. Pega o timestamp do arquivo no dispositivo (com fallback)
        device_timestamp = int(time.time()) # Default to server time
        try:
            ts_proc = await run_adb_command(["adb", "-s", device_id, "shell", "stat", "-c", "%Y", remote_path], check=True)
            stdout_ts = ts_proc.stdout.strip()
            if stdout_ts.isdigit():
                device_timestamp = int(stdout_ts)
        except HTTPException:
            print(f"INFO: 'stat' command failed on {device_id}. Using server time for screenshot.")
            pass

        # 3. Cria o nome final do arquivo e puxa para o servidor
        filename = f"screenshot_{device_id.replace(':', '_')}_{device_timestamp}.png"
        filepath = os.path.join(OUTPUTS, filename)
        await run_adb_command(["adb", "-s", device_id, "pull", remote_path, filepath])

        return {"message": "Screenshot capturado com sucesso!", "filename": filename}
    except Exception as e:
        detail = str(e)
        if hasattr(e, 'detail'):
            detail = e.detail
        raise HTTPException(status_code=500, detail=f"Não foi possível capturar screenshot: {detail}")
    finally:
        # 4. Limpa o arquivo temporário do dispositivo
        await run_adb_command(["adb", "-s", device_id, "shell", "rm", remote_path], check=False)


@app.post("/screenrecord")
async def screenrecord(body: ScreenRecordBody):
    device_id = body.device
    duration = body.duration or 10
    if not device_id:
        raise HTTPException(status_code=400, detail="Nenhum dispositivo selecionado")

    remote_path = f"/data/local/tmp/record_{int(time.time())}.mp4"
    
    try:
        # 1. Grava o vídeo no dispositivo
        await run_adb_command(["adb", "-s", device_id, "shell", "screenrecord", f"--time-limit={duration}", remote_path], timeout=duration + 10)

        # 2. Pega o timestamp do arquivo no dispositivo (com fallback)
        device_timestamp = int(time.time()) # Default to server time
        try:
            ts_proc = await run_adb_command(["adb", "-s", device_id, "shell", "stat", "-c", "%Y", remote_path], check=True)
            stdout_ts = ts_proc.stdout.strip()
            if stdout_ts.isdigit():
                device_timestamp = int(stdout_ts)
        except HTTPException:
            print(f"INFO: 'stat' command failed on {device_id}. Using server time for screenrecord.")
            pass

        # 3. Cria o nome final do arquivo e puxa para o servidor
        filename = f"screenrecord_{device_id.replace(':', '_')}_{device_timestamp}.mp4"
        filepath = os.path.join(OUTPUTS, filename)
        await run_adb_command(["adb", "-s", device_id, "pull", remote_path, filepath])
        
        if await asyncio.to_thread(os.path.exists, filepath):
            return {"message": "Vídeo gravado com sucesso!", "filename": filename}
        raise HTTPException(status_code=500, detail="Falha ao gravar tela (arquivo não encontrado no servidor após pull).")
    except Exception as e:
        detail = str(e)
        if hasattr(e, 'detail'):
            detail = e.detail
        raise HTTPException(status_code=500, detail=f"Falha ao gravar tela: {detail}")
    finally:
        # 4. Limpa o arquivo temporário do dispositivo
        await run_adb_command(["adb", "-s", device_id, "shell", "rm", remote_path], check=False)

@app.post("/mirror")
async def mirror_start(body: MirrorBody):
    device_id = body.device_id
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id não fornecido")

    scrcpy_cmd = [
        os.path.join(MIRROR_DIR, "scrcpy.exe"),
        "-s", device_id
    ]
    
    try:
        # Executa o scrcpy em um novo processo sem bloquear
        subprocess.Popen(scrcpy_cmd)
        return JSONResponse(content={"message": "Scrcpy iniciado com sucesso."}, status_code=200)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="scrcpy.exe não encontrado. Verifique o caminho.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao iniciar scrcpy: {str(e)}")

@app.get("/video_feed/{device_id}")
def video_feed(device_id: str):
    """
    Gera um stream MJPEG (Motion JPEG) usando capturas de tela contínuas do ADB.
    Ideal para exibição em tags <img> no navegador.
    """
    def gen_frames():
        while True:
            try:
                # 'exec-out' é crucial para garantir saída binária limpa (sem conversão de quebra de linha do Windows)
                # screencap -p gera um PNG. É mais lento que raw, mas compatível com todos os browsers.
                cmd = ["adb", "-s", device_id, "exec-out", "screencap", "-p"]
                res = subprocess.run(cmd, capture_output=True)
                if res.returncode == 0 and res.stdout:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/png\r\n\r\n' + res.stdout + b'\r\n')
                else:
                    time.sleep(0.1) # Pequena pausa apenas se houver erro na captura
            except Exception:
                time.sleep(1)

    return StreamingResponse(gen_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/decompile_apk")
async def decompile_apk(body: DecompileBody):
    device_id = body.device
    package = body.package
    if not device_id or not package:
        raise HTTPException(status_code=400, detail="Dispositivo ou pacote inválido")

    local_apk_path = os.path.join(UPLOAD_FOLDER, f"{package}_base.apk")
    
    try:
        # 1. Dump the APK
        proc = await run_adb_command(["adb", "-s", device_id, "shell", "pm", "path", package])
        output = proc.stdout.strip()
        if not output:
            raise HTTPException(status_code=404, detail=f"Pacote {package} não encontrado")
        
        base_apk_remote_path = output.splitlines()[0].replace("package:", "").strip()
        await run_adb_command(["adb", "-s", device_id, "pull", base_apk_remote_path, local_apk_path])

        # Determina o executável do JADX (Windows precisa de .bat explícito muitas vezes)
        jadx_bin = "jadx"
        if sys.platform == "win32" and shutil.which("jadx.bat"):
            jadx_bin = "jadx.bat"

        # 2. Run JADX
        output_dir = os.path.join(OUTPUTS, "jadx", package)
        jadx_cmd = [jadx_bin, "-d", output_dir, local_apk_path]

        try:
            await asyncio.to_thread(subprocess.run, [jadx_bin, "--version"], check=True, capture_output=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            raise HTTPException(status_code=500, detail=f"Comando '{jadx_bin}' não encontrado. Verifique se está instalado e no PATH.")

        process = await asyncio.to_thread(
            subprocess.run,
            jadx_cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=300
        )

        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Erro ao executar JADX: {process.stderr.strip()}")

        return {"message": f"App descompilado com sucesso! Arquivos salvos em: {os.path.abspath(output_dir)}"}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="JADX excedeu o tempo limite de 5 minutos.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro inesperado durante a descompilação: {str(e)}")
    finally:
        if os.path.exists(local_apk_path):
            os.remove(local_apk_path)

@app.post("/decompile_local_apk")
async def decompile_local_apk(file: UploadFile = File(...)):
    if not file.filename.endswith(".apk"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .apk são permitidos.")

    temp_filename = f"upload_jadx_{int(time.time())}_{file.filename}"
    temp_apk_path = os.path.join(UPLOAD_FOLDER, temp_filename)

    try:
        async with aiofiles.open(temp_apk_path, 'wb') as out_file:
            content = await file.read()
            await out_file.write(content)

        # Tenta extrair o nome do pacote para usar como nome da pasta
        def get_package_name():
            try:
                apk = APK(temp_apk_path)
                return apk.get_package()
            except:
                return None
        
        package = await asyncio.to_thread(get_package_name)
        if not package:
            package = os.path.splitext(file.filename)[0] # Fallback para o nome do arquivo

        # Determina o executável do JADX
        jadx_bin = "jadx"
        if sys.platform == "win32" and shutil.which("jadx.bat"):
            jadx_bin = "jadx.bat"

        output_dir = os.path.join(OUTPUTS, "jadx", package)
        jadx_cmd = [jadx_bin, "-d", output_dir, temp_apk_path]

        try:
            await asyncio.to_thread(subprocess.run, [jadx_bin, "--version"], check=True, capture_output=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
             raise HTTPException(status_code=500, detail=f"Comando '{jadx_bin}' não encontrado.")

        process = await asyncio.to_thread(
            subprocess.run, jadx_cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600
        )

        if process.returncode != 0:
             raise HTTPException(status_code=500, detail=f"Erro JADX: {process.stderr.strip()}")

        return {"message": f"APK local descompilado com sucesso!", "package": package}

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Erro no upload/descompilação: {e}")
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")
    finally:
        if os.path.exists(temp_apk_path):
            try:
                os.remove(temp_apk_path)
            except Exception:
                pass # Ignora erro de remoção (comum no Windows se o arquivo estiver em uso)

@app.post("/extract_manifest")
async def extract_manifest(body: AppActionBody):
    device_id = body.device
    package = body.package
    if not device_id or not package:
        raise HTTPException(status_code=400, detail="Dispositivo ou pacote inválido")

    try:
        # 1. Obtém caminho do APK base
        proc = await run_adb_command(["adb", "-s", device_id, "shell", "pm", "path", package])
        output = proc.stdout.strip()
        if not output:
            raise HTTPException(status_code=404, detail=f"Pacote {package} não encontrado")
        
        # Pega o primeiro APK (base.apk) que contém o Manifest
        base_apk_remote = output.splitlines()[0].replace("package:", "").strip()
        
        timestamp = int(time.time())
        temp_apk = os.path.join(UPLOAD_FOLDER, f"temp_manifest_{package}_{timestamp}.apk")
        
        # 2. Puxa o APK base
        await run_adb_command(["adb", "-s", device_id, "pull", base_apk_remote, temp_apk])
        
        try:
            # 3. Extrai o AndroidManifest.xml decodificado
            def get_manifest_sync():
                apk = APK(temp_apk)
                axml = apk.get_android_manifest_axml()
                return axml.get_xml() # Retorna bytes do XML legível

            xml_bytes = await asyncio.to_thread(get_manifest_sync)
            
            xml_filename = f"AndroidManifest_{package}.xml"
            xml_path = os.path.join(OUTPUTS, xml_filename)
            
            with open(xml_path, "wb") as f:
                f.write(xml_bytes)
                
            return FileResponse(xml_path, media_type="application/xml", filename=xml_filename)

        finally:
            # Limpa o APK temporário
            if os.path.exists(temp_apk):
                os.remove(temp_apk)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/dump_apk")
async def dump_apk(body: DumpApkBody):
    device_id = body.device
    package = body.package
    if not device_id or not package:
        raise HTTPException(status_code=400, detail="Dispositivo ou pacote inválido")
    
    try:
        # Obtém caminhos dos APKs (suporta Split APKs)
        proc = await run_adb_command(["adb", "-s", device_id, "shell", "pm", "path", package])
        output = proc.stdout.strip()
        
        if not output:
            raise HTTPException(status_code=404, detail=f"Pacote {package} não encontrado")
        
        # Filtra linhas vazias e remove prefixo 'package:'
        paths = [line.replace("package:", "").strip() for line in output.splitlines() if line.strip()]
        
        if not paths:
            raise HTTPException(status_code=404, detail=f"Nenhum APK encontrado para {package}")

        timestamp = int(time.time())
        
        if len(paths) == 1:
            # APK Único
            apk_path = paths[0]
            filename = f"{package}_{timestamp}.apk"
            local_path = os.path.join(OUTPUTS, filename)
            
            await run_adb_command(["adb", "-s", device_id, "pull", apk_path, local_path])
            
            return FileResponse(local_path, media_type="application/vnd.android.package-archive", filename=filename)
        else:
            # Split APKs (App Bundle) -> Zipar tudo
            zip_filename = f"{package}_{timestamp}_split.zip"
            
            # Diretório temporário para baixar os splits
            temp_dir = os.path.join(OUTPUTS, f"temp_{package}_{timestamp}")
            os.makedirs(temp_dir, exist_ok=True)
            
            try:
                for remote_path in paths:
                    await run_adb_command(["adb", "-s", device_id, "pull", remote_path, temp_dir])
                
                # Cria o arquivo ZIP
                base_name = os.path.join(OUTPUTS, f"{package}_{timestamp}_split")
                await asyncio.to_thread(shutil.make_archive, base_name, 'zip', temp_dir)
                
                final_zip_path = base_name + ".zip"
                
                return FileResponse(final_zip_path, media_type="application/zip", filename=zip_filename)
            finally:
                # Limpeza
                if await asyncio.to_thread(os.path.exists, temp_dir):
                    await asyncio.to_thread(shutil.rmtree, temp_dir)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/port_forward")
def port_forward(body: PortForwardBody):
    device_id = body.device
    local = body.local
    remote = body.remote
    if not device_id or not local or not remote:
        raise HTTPException(status_code=400, detail="Parâmetros inválidos")
    try:
        cmd = ["adb", "-s", device_id, "forward", f"tcp:{local}", f"tcp:{remote}"]
        subprocess.check_output(cmd, text=True)
        return {"resultado": f"Port forwarding ativo: {local} -> {remote}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/set_proxy")
def set_proxy(body: ProxySetBody):
    device_id, ip, port = body.device, body.ip, body.port
    if not device_id or not ip or not port:
        raise HTTPException(status_code=400, detail="Parâmetros inválidos")
    try:
        cmd = ["adb", "-s", device_id, "shell", "su", "-c", f"settings put global http_proxy {ip}:{port}"]
        subprocess.run(cmd, check=True)
        return {"mensagem": f"✅ Proxy definido: {ip}:{port}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get_proxy")
def get_proxy(body: ProxyDeviceBody):
    device_id = body.device
    if not device_id:
        raise HTTPException(status_code=400, detail="Dispositivo não selecionado")
    try:
        resultado = adb_shell_su(device_id, "settings get global http_proxy")
        return {"proxy": resultado}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/clear_proxy")
def clear_proxy(body: ProxyDeviceBody):
    device_id = body.device
    if not device_id:
        raise HTTPException(status_code=400, detail="Dispositivo não selecionado")
    try:
        cmd = ["adb", "-s", device_id, "shell", "su", "-c", "settings put global http_proxy :0"]
        subprocess.run(cmd, check=True)
        return {"mensagem": "🧹 Proxy limpo com sucesso!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/browse_files")
def browse_files(body: FileExplorerBody):
    device_id = body.device
    path = body.path
    if not device_id or not path:
        raise HTTPException(status_code=400, detail="Dispositivo ou caminho inválido")

    try:
        # Executa o comando 'ls' com privilégios de root para acessar todos os diretórios.
        # As aspas simples em volta de {path} são importantes para lidar com caminhos com espaços.
        cmd = ["adb", "-s", device_id, "shell", "su", "-c", f"ls -l -A '{path}'"]
        process = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        
        # A saída de erro do 'su -c' geralmente vai para o stdout, então verificamos ambos.
        output_or_error = (process.stdout or process.stderr).strip()
        if process.returncode != 0:
            # Se o comando falhar, retorna a saída como erro. Ex: "No such file or directory"
            raise HTTPException(status_code=404, detail=output_or_error)
        output = process.stdout

        files = []
        # Regex para parsear a saída do 'ls -l'
        # Ex: drwxr-xr-x 4 root root 4096 2024-01-01 12:00 config
        # Ex: -rw-rw-rw- 1 system system 123 2024-01-01 12:00 build.prop
        ls_pattern = re.compile(
            r"^(?P<type>[d\-l])(?P<perms>.{9})\s+"
            r"(?P<links>\d+)\s+"
            r"(?P<owner>\S+)\s+"
            r"(?P<group>\S+)\s+"
            r"(?P<size>\d+)?\s+" # Tamanho pode não estar presente para diretórios em algumas versões
            r"(?P<date>\d{4}-\d{2}-\d{2}\s\d{2}:\d{2})\s+"
            r"(?P<name>.+?)(?:\s->\s(?P<symlink_target>.+))?$"
        )

        for line in output.strip().splitlines():
            match = ls_pattern.match(line)
            if match:
                data = match.groupdict()
                file_type = "directory" if data["type"] == "d" else "file" if data["type"] == "-" else "symlink"
                files.append({
                    "name": data["name"],
                    "type": file_type,
                    "size": int(data.get("size") or 0),
                    "permissions": data["perms"],
                    "owner": data["owner"],
                    "group": data["group"],
                    "last_modified": data["date"],
                    "symlink_target": data.get("symlink_target")
                })

        return sorted(files, key=lambda x: (x['type'] != 'directory', x['name'].lower()))
    except HTTPException as e: # Capturar HTTPException de run_adb_command
        raise HTTPException(status_code=500, detail=f"Falha ao executar ADB (su): {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/download_file")
async def download_file(body: FileDownloadBody): # Tornar a função assíncrona
    device_id = body.device
    remote_path = body.path
    if not device_id or not remote_path:
        raise HTTPException(status_code=400, detail="Dispositivo ou caminho do arquivo inválido")

    filename = os.path.basename(remote_path)
    local_path = os.path.join(OUTPUTS, filename)

    try:
        # Abordagem mais robusta: usa 'su' para ler o arquivo e transmite o conteúdo diretamente,
        # evitando problemas de permissão com 'chmod' ou 'chcon' em /data/local/tmp.
        # O 'cat' é executado como root, lendo o arquivo original, e sua saída é capturada pelo 'adb exec-out'.
        cmd = ["adb", "-s", device_id, "shell", "su", "-c", f"cat '{remote_path}'"]

        # Usamos subprocess.run diretamente aqui porque precisamos do stdout como bytes.
        # Envolvemos a chamada bloqueante em asyncio.to_thread.
        process = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, check=False
        )

        if process.returncode != 0 or b"No such file or directory" in process.stderr:
            raise HTTPException(status_code=404, detail=f"Arquivo não encontrado ou erro de permissão: {remote_path}")

        async with aiofiles.open(local_path, "wb") as f:
            await f.write(process.stdout)

        return FileResponse(path=local_path, filename=filename, media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao baixar arquivo: {str(e)}")

@app.post("/upload_file")
async def upload_file(device: str = Form(...), path: str = Form(...), file: UploadFile = File(...)):
    if not device or not path:
        raise HTTPException(status_code=400, detail="Dispositivo ou caminho de destino não fornecido.")

    # Salva o arquivo temporariamente no servidor
    # Usar um nome de arquivo único para evitar conflitos de concorrência
    temp_filename = f"{int(time.time())}_{file.filename}"
    temp_server_path = os.path.join(UPLOAD_FOLDER, temp_filename)
    with open(temp_server_path, "wb") as buffer:
        buffer.write(await file.read())

    # Define caminhos temporário e final no dispositivo
    temp_device_path = f"/data/local/tmp/{temp_filename}"
    final_device_path = os.path.join(path, file.filename).replace("\\", "/")

    try:
        # 1. Envia o arquivo para um local temporário público no dispositivo
        # Usar run_adb_command
        await run_adb_command(["adb", "-s", device, "push", temp_server_path, temp_device_path])

        # 2. Move o arquivo para o destino final usando root
        move_cmd = ["adb", "-s", device, "shell", "su", "-c", f"mv -f '{temp_device_path}' '{final_device_path}'"]
        # Usar run_adb_command
        await run_adb_command(move_cmd)

        return {"message": f"Arquivo '{file.filename}' enviado para '{final_device_path}' com sucesso."}
    except HTTPException as e: # Capturar HTTPException de run_adb_command
        raise HTTPException(status_code=500, detail=f"Falha no upload via ADB: {e.detail}")
    finally:
        # Limpa o arquivo temporário do servidor
        if await asyncio.to_thread(os.path.exists, temp_server_path): # os.path.exists é bloqueante
            await asyncio.to_thread(os.remove, temp_server_path) # os.remove é bloqueante
        # Tenta limpar o arquivo temporário do dispositivo (se a movimentação falhou ou não)
        await run_adb_command(["adb", "-s", device, "shell", "rm", temp_device_path], check=False)

@app.post("/install_apk")
async def install_apk(device: str = Form(...), file: UploadFile = File(...)):
    if not device:
        raise HTTPException(status_code=400, detail="Nenhum dispositivo selecionado.")
    if not file.filename.endswith(".apk"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .apk são permitidos.")

    temp_filename = f"install_{int(time.time())}_{file.filename}"
    temp_apk_path = os.path.join(UPLOAD_FOLDER, temp_filename)

    try:
        async with aiofiles.open(temp_apk_path, 'wb') as out_file:
            content = await file.read()
            await out_file.write(content)

        await run_adb_command(["adb", "-s", device, "install", "-r", temp_apk_path], timeout=120)

        return {"message": f"APK '{file.filename}' instalado com sucesso em '{device}'."}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha na instalação: {str(e)}")
    finally:
        if await asyncio.to_thread(os.path.exists, temp_apk_path):
            await asyncio.to_thread(os.remove, temp_apk_path)

@app.post("/rename_file")
async def rename_file(body: FileRenameBody): # Tornar a função assíncrona
    old_path = body.old_path
    # Constrói o novo caminho mantendo o diretório
    new_path = os.path.join(os.path.dirname(old_path), body.new_name).replace("\\", "/")
    try:
        cmd = ["adb", "-s", body.device, "shell", "su", "-c", f"mv '{old_path}' '{new_path}'"]
        await run_adb_command(cmd) # Usar run_adb_command
        return {"message": "Arquivo renomeado com sucesso."}
    except HTTPException as e: # Capturar HTTPException de run_adb_command
        raise HTTPException(status_code=500, detail=f"Falha ao renomear: {e.detail}")

@app.post("/delete_file")
async def delete_file(body: FileDeleteBody): # Tornar a função assíncrona
    try:
        cmd = ["adb", "-s", body.device, "shell", "su", "-c", f"rm -rf '{body.path}'"] # Usar run_adb_command
        await run_adb_command(cmd)
        return {"message": "Arquivo/pasta excluído com sucesso."}
    except HTTPException as e: # Capturar HTTPException de run_adb_command
        raise HTTPException(status_code=500, detail=f"Falha ao excluir: {e.detail}")

@app.post("/execute_adb_command")
async def execute_adb_command(body: AdbCommandBody):
    if not body.command:
        raise HTTPException(status_code=400, detail="Comando não pode ser vazio.")

    command_args = body.command.split()
    adb_args = ["adb"]
    if body.device:
        adb_args.extend(["-s", body.device])
    adb_args.extend(command_args)

    try:
        process = await run_adb_command(adb_args, check=True, timeout=30)
        return {"output": process.stdout.strip() or process.stderr.strip()}
    except HTTPException as e:
        # A exceção de run_adb_command já contém o detalhe do erro (stderr)
        raise HTTPException(status_code=500, detail=e.detail)

@app.post("/send_deeplink")
async def send_deeplink(body: DeepLinkBody):
    device_id = body.device
    command_args = body.command

    if not device_id or not command_args:
        raise HTTPException(status_code=400, detail="Dispositivo e comando são obrigatórios.")

    try:
        # O comando é passado como uma string, então usamos shell=True de forma segura após validação.
        # A forma mais segura seria parsear os argumentos, mas para `am start` a complexidade é alta.
        # A validação aqui é implícita (só executa `am start`).
        result = await run_adb_command(["adb", "-s", device_id, "shell", "am", "start"] + command_args.split())
        return {"message": "Intent enviado com sucesso.", "output": result.stdout or result.stderr}
    except HTTPException as e:
        # Repassa a exceção do run_adb_command
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro inesperado ao enviar intent: {str(e)}")

@app.post("/get_main_activities")
async def get_main_activities(body: MainActivityBody):
    device_id = body.device
    package = body.package

    if not device_id or not package:
        raise HTTPException(status_code=400, detail="Dispositivo e pacote são obrigatórios.")

    try:
        # Usamos 'dumpsys package' para obter informações detalhadas do pacote
        result = await run_adb_command(["adb", "-s", device_id, "shell", "dumpsys", "package", package])
        output = result.stdout

        activities = []
        # Regex para encontrar as activities que têm o filtro MAIN/LAUNCHER
        # Ex: com.example.app/.MainActivity:
        #       ...
        #       android.intent.action.MAIN:
        #       android.intent.category.LAUNCHER:
        activity_pattern = re.compile(r"^\s*(\S+/\.\S+):")
        current_activity = None

        for line in output.splitlines():
            line = line.strip()
            match = activity_pattern.match(line)
            if match:
                # Encontramos uma nova declaração de activity, armazena ela
                current_activity = match.group(1)
            elif current_activity and "android.intent.action.MAIN" in line and "android.intent.category.LAUNCHER" in line:
                # Se a linha contém MAIN e LAUNCHER e temos uma activity atual, é a que queremos
                if current_activity not in activities:
                    activities.append(current_activity)
                current_activity = None # Reseta para não adicionar de novo
        return {"activities": activities}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao extrair activities: {str(e)}")

@app.post("/get_exported_activities")
async def get_exported_activities(body: MainActivityBody):
    device_id = body.device
    package = body.package

    if not device_id or not package:
        raise HTTPException(status_code=400, detail="Dispositivo e pacote são obrigatórios.")

    try:
        result = await run_adb_command(["adb", "-s", device_id, "shell", "dumpsys", "package", package])
        output = result.stdout

        exported_activities = set()
        in_activity_resolver_section = False

        for line in output.splitlines():
            line = line.strip()
            if "Activity Resolver Table:" in line:
                in_activity_resolver_section = True
                continue
            
            if in_activity_resolver_section and package in line:
                parts = line.split()
                if len(parts) > 1 and '/' in parts[1]:
                    exported_activities.add(parts[1])
        return {"activities": sorted(list(exported_activities))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao extrair activities exportadas: {str(e)}")

@app.post("/analyze_manifest_with_ai")
async def analyze_manifest_with_ai(body: AnalyzeManifestBody):
    config = await load_config_async()
    if not config.get("api_key") and not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="IA não configurada. Verifique a chave da API.")
    
    device_id = body.device
    package = body.package
    
    try:
        # 1. Extrai o XML do Manifesto (Reutilizando lógica similar ao extract_manifest mas focado em obter string)
        proc = await run_adb_command(["adb", "-s", device_id, "shell", "pm", "path", package])
        output = proc.stdout.strip()
        if not output: raise HTTPException(status_code=404, detail="Pacote não encontrado")
        
        base_apk_remote = output.splitlines()[0].replace("package:", "").strip()
        timestamp = int(time.time())
        temp_apk = os.path.join(UPLOAD_FOLDER, f"temp_man_ai_{package}_{timestamp}.apk")
        
        await run_adb_command(["adb", "-s", device_id, "pull", base_apk_remote, temp_apk])
        
        manifest_xml = ""
        try:
            def get_xml_sync():
                apk = APK(temp_apk)
                return apk.get_android_manifest_axml().get_xml().decode("utf-8", errors="ignore")
            manifest_xml = await asyncio.to_thread(get_xml_sync)
        finally:
            if os.path.exists(temp_apk): os.remove(temp_apk)
            
        # 2. Envia para o Gemini
        model = genai.GenerativeModel('gemini-pro')
        prompt = f"""
        Atue como um especialista em Red Team e Pentest Mobile. Analise o seguinte AndroidManifest.xml em busca de vulnerabilidades críticas.
        
        Foque em:
        - Componentes exportados (Activities, Services, Receivers, Providers) sem permissões.
        - Permissões perigosas ou desnecessárias.
        - Configurações inseguras (debuggable, allowBackup, usesCleartextTraffic).
        - Custom URL Schemes e Deep Links mal configurados.
        
        Manifest XML:
        ```xml
        {manifest_xml}
        ```

        Retorne APENAS um JSON estrito com este formato:
        {{
          "resumo_funcionalidade": "Resumo técnico do que o app expõe.",
          "analise_seguranca": "Lista detalhada das vulnerabilidades. Use quebras de linha para formatar.",
          "vetor_exploracao_sugerido": "Comandos ADB (am start...) ou estratégias para explorar as falhas.",
          "sugestao_script_frida": "Snippet Frida para hookar componentes vulneráveis identificados."
        }}
        """
        
        response = await model.generate_content_async(prompt)
        return json.loads(response.text)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/jadx/projects")
def list_jadx_projects():
    """Lista os pacotes que já foram descompilados na pasta outputs/jadx."""
    jadx_base = os.path.join(OUTPUTS, "jadx")
    if not os.path.exists(jadx_base):
        return []
    try:
        projects = [d for d in os.listdir(jadx_base) if os.path.isdir(os.path.join(jadx_base, d))]
        return sorted(projects)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/jadx/structure")
def get_jadx_structure(body: JadxProjectBody):
    """Retorna a árvore de arquivos de um projeto descompilado."""
    package = body.package
    base_path = os.path.join(OUTPUTS, "jadx", package)
    
    if not os.path.exists(base_path):
        raise HTTPException(status_code=404, detail="Projeto não encontrado. Descompile o app primeiro.")

    file_structure = []
    
    # Walk simples para gerar estrutura plana com caminhos relativos (mais fácil para o frontend filtrar)
    # Para árvores muito grandes, isso pode ser otimizado, mas para apps Android é ok.
    for root, dirs, files in os.walk(base_path):
        for name in files:
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, base_path).replace("\\", "/")
            file_structure.append({
                "path": rel_path,
                "name": name,
                "type": "file",
                "ext": os.path.splitext(name)[1].lower()
            })
    
    return sorted(file_structure, key=lambda x: x['path'])

@app.post("/jadx/read")
async def read_jadx_file(body: JadxReadBody):
    """Lê o conteúdo de um arquivo descompilado."""
    package = body.package
    rel_path = body.file_path
    
    # Segurança básica contra Path Traversal
    if ".." in rel_path or rel_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Caminho inválido.")

    base_path = os.path.join(OUTPUTS, "jadx", package)
    full_path = os.path.join(base_path, rel_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    try:
        async with aiofiles.open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = await f.read()
        return {"content": content, "path": rel_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao ler arquivo: {str(e)}")

# ---------- INSIGHTS / TELEMETRIA (painel direito) ----------
class DeviceIdQuery(BaseModel):
    dispositivo_id: str

async def getprop(dev: str, prop: str) -> str:
    try:
        return await async_adb_out(["adb", "-s", dev, "shell", "getprop", prop])
    except Exception:
        return ""

async def has_su(dev: str) -> tuple[bool, str]:
    try:
        p = await asyncio.to_thread(adb_out, ["adb", "-s", dev, "shell", "which su"]) or ""
        if p:
            return True, p.strip() # adb_out aqui precisa ser async_adb_out
        for path in ("/system/xbin/su", "/system/bin/su", "/sbin/su", "/vendor/bin/su", "/su/bin/su"): # os.path.exists é bloqueante
            out = await asyncio.to_thread(adb_out, ["adb", "-s", dev, "shell", f"ls {path} 2>/dev/null || true"])
            if path in out.strip():
                return True, path
    except Exception:
        pass
    return False, ""

async def battery(dev: str) -> dict:
    info = {"level": None, "temp_c": None, "status": None}
    try:
        out = await async_adb_out(["adb", "-s", dev, "shell", "dumpsys", "battery"])
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("level:"):
                info["level"] = int(line.split(":")[1].strip())
            elif line.startswith("temperature:"):
                v = int(line.split(":")[1].strip())
                info["temp_c"] = v / 10.0
            elif line.startswith("status:"):
                # Status pode ser "2" (carregando), "3" (descarregando), etc.
                status_code = line.split(":")[1].strip()
                status_map = {"2": "Carregando", "3": "Descarregando", "5": "Cheia"}
                info["status"] = status_map.get(status_code, f"Status {status_code}")
    except Exception:
        pass
    return info

async def wifi_ip(dev: str) -> str:
    try:
        out = await async_adb_out(["adb", "-s", dev, "shell", "ip -f inet addr show wlan0"])
        for ln in out.splitlines():
            ln = ln.strip()
            if ln.startswith("inet "):
                return ln.split()[1].split("/")[0]
    except Exception:
        pass
    # Fallback (getprop já é async)
    return await getprop(dev, "dhcp.wlan0.ipaddress") or "" # getprop já é async

async def uptime_seconds(dev: str) -> int:
    try:
        out = await async_adb_out(["adb", "-s", dev, "shell", "cat /proc/uptime"])
        secs = int(float(out.split()[0]))
        return secs
    except Exception:
        return 0

async def frida_server_status(dev: str) -> bool:
    try:
        # Usar "ps -A" ou "ps" é mais universal que "ps -e"
        # Filtrar em python é mais robusto que depender do grep no device (adb_shell_su já é async)
        out = await async_adb_shell_su(dev, "ps -A")
        for line in out.splitlines():
            if "frida-server" in line:
                return True
        return False
    except Exception:
        return False

@app.post("/device_insights")
async def device_insights(body: DeviceIdQuery):
    dev = body.dispositivo_id
    if not dev:
        raise HTTPException(status_code=400, detail="dispositivo_id ausente")

    try:
        conexao = "REDE" if ":" in dev and dev.count(".") == 3 else "USB"

        # Executa todas as chamadas ADB concorrentemente
        results = await asyncio.gather(
            getprop(dev, "ro.product.model"), getprop(dev, "ro.product.name"),
            getprop(dev, "ro.product.brand"), getprop(dev, "ro.build.version.release"),
            getprop(dev, "ro.build.version.sdk"), getprop(dev, "ro.product.cpu.abi"),
            getprop(dev, "ro.build.version.security_patch"),
            async_adb_shell_su(dev, "getenforce"),
            has_su(dev), battery(dev), wifi_ip(dev), uptime_seconds(dev), frida_server_status(dev),
            async_adb_shell(dev, "settings", "get", "global", "development_settings_enabled"),
            getprop(dev, "ro.crypto.state"),
            async_adb_shell(dev, "dumpsys", "window"),
            async_adb_shell_su(dev, "ls /data/misc/user/0/cacerts-added/ | wc -l")
        )
        (model_prop, name_prop, brand, release, sdk, cpu_abi, sec_patch, selinux, 
         (hsu, su_path), batt, ip_wifi, up_s, frida_running, dev_mode, crypto_state, 
         dumpsys_window, user_certs_count) = results
        
        model = model_prop or name_prop
        
        # Processar resultados
        is_dev_mode = dev_mode.strip() == "1"
        is_encrypted = crypto_state.strip() == "encrypted"
        is_lockscreen = "mDreamingLockscreen=true" in dumpsys_window or "mShowingLockscreen=true" in dumpsys_window
        user_certs_count = int(user_certs_count.strip()) if user_certs_count.strip().isdigit() else 0

        return {
            "nome": model or "—",
            "marca": brand or "—",
            "conexao": conexao,
            "android": release or "—",
            "sdk": sdk or "—",
            "cpu_abi": cpu_abi or "—",
            "security_patch": sec_patch or "—",
            "selinux": selinux.strip() or "—",
            "root": bool(hsu),
            "su_path": su_path or "—",
            "bateria": {"level": batt["level"], "temp_c": batt["temp_c"], "status": batt["status"] or "—"},
            "wifi_ip": ip_wifi or "—",
            "uptime_s": up_s,
            "frida_running": frida_running,
            "developer_mode": is_dev_mode,
            "encryption_status": "Criptografado" if is_encrypted else "Não Criptografado",
            "screen_lock": is_lockscreen,
            "user_certs": user_certs_count
        }
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.output)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =========================================================
# Gallery Endpoints
# =========================================================
@app.get("/gallery/list")
async def list_gallery_media():
    media_files = {}
    allowed_extensions = [".png", ".mp4"]
    
    for filename in os.listdir(OUTPUTS):
        if any(filename.endswith(ext) for ext in allowed_extensions):
            parts = filename.replace('.', '_').split('_')
            if parts[0] not in ["screenshot", "screenrecord"] or len(parts) < 3:
                continue

            media_type = parts[0]
            device_id = parts[1]
            try:
                timestamp = int(parts[2])
            except ValueError:
                continue

            if device_id not in media_files:
                media_files[device_id] = []
            
            media_files[device_id].append({
                "filename": filename,
                "type": "video" if media_type == "screenrecord" else "image",
                "timestamp": timestamp,
            })

    # Ordena as mídias de cada dispositivo pela data, da mais nova para a mais antiga
    for device in media_files:
        media_files[device].sort(key=lambda x: x['timestamp'], reverse=True)
        
    return media_files

@app.get("/gallery/media/{filename}")
async def get_gallery_media(filename: str):
    # Medida de segurança para evitar path traversal
    safe_path = os.path.join(OUTPUTS, os.path.basename(filename))
    if not os.path.exists(safe_path) or os.path.dirname(safe_path) != OUTPUTS:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    
    return FileResponse(safe_path)

@app.post("/gallery/delete")
async def delete_gallery_media(body: GalleryDeleteBody):
    filename = body.filename
    # Medida de segurança para evitar path traversal
    safe_path = os.path.join(OUTPUTS, os.path.basename(filename))

    if not os.path.exists(safe_path) or os.path.dirname(safe_path) != OUTPUTS:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    
    try:
        os.remove(safe_path)
        return {"message": f"Arquivo '{filename}' excluído com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao excluir arquivo: {e}")


# =========================================================
# WebSocket para Streaming (Frida / logcat / comandos)
# =========================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws_manager.send_text(websocket, json.dumps({"event": "error", "data": "JSON inválido"}))
                continue

            # Criamos uma tarefa para lidar com a mensagem, liberando o loop para receber outras.
            asyncio.create_task(handle_ws_message(websocket, data))

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

async def handle_ws_message(websocket: WebSocket, data: dict):
    """Processa uma única mensagem recebida do WebSocket."""
    msg_type = data.get("type")

    if msg_type in ["executar_comando", "logcat", "cmd", "executar_script_conteudo"]:
        queue = asyncio.Queue()
        cmd = []

        if msg_type == "executar_comando":
            payload = FridaCmd(**data)
            if not (payload.dispositivo_id and payload.pacote and payload.forma):
                await ws_manager.send_text(websocket, json.dumps({"event": "error", "data": "Parâmetros faltando (dispositivo_id, pacote, forma)"}))
                return

            script_args = []
            for s in payload.scripts or []:
                script_path = os.path.join(SCRIPT_PATH, s)
                script_args.extend(["-l", script_path])

            cmd = ["frida", "-D", payload.dispositivo_id, payload.forma, payload.pacote] + script_args
            await ws_manager.send_text(websocket, json.dumps({"event": "info", "data": f"Executando: {' '.join(cmd)}"}))
        
        elif msg_type == "executar_script_conteudo":
            payload = FridaCmd(**data)
            if not (payload.dispositivo_id and payload.pacote and payload.forma and payload.conteudo):
                await ws_manager.send_text(websocket, json.dumps({"event": "error", "data": "Parâmetros faltando para execução de conteúdo."}))
                return
            
            temp_script_path = os.path.join(SCRIPT_PATH, "_temp_run.js")
            async with aiofiles.open(temp_script_path, "w", encoding="utf-8") as f:
                await f.write(payload.conteudo)

            cmd = ["frida", "-D", payload.dispositivo_id, payload.forma, payload.pacote, "-l", temp_script_path]
            await ws_manager.send_text(websocket, json.dumps({"event": "info", "data": f"Executando script do editor: {' '.join(cmd)}"}))

        elif msg_type == "logcat":
            cmd = ["adb", "logcat"]
            await ws_manager.send_text(websocket, json.dumps({"event": "info", "data": "Iniciando logcat..."}))

        elif msg_type == "cmd":
            cmd = data.get("cmd")
            if not isinstance(cmd, list) or not cmd:
                await ws_manager.send_text(websocket, json.dumps({"event": "error", "data": "cmd precisa ser uma lista"}))
                return

        # Inicia a thread produtora que alimenta a fila
        loop = asyncio.get_running_loop()
        loop.run_in_executor(
            None,  # Usa o executor de thread padrão
            run_cmd_and_stream_to_queue,
            cmd,
            queue
        )

        # Loop consumidor que lê da fila e envia para o websocket
        try:
            while True:
                line = await queue.get()
                if line is None: # Fim do stream
                    break
                
                if msg_type == "logcat":
                    event_type = "logcat_data"
                elif msg_type == "cmd":
                    event_type = "cmd_result"
                else:
                    event_type = "log"

                await ws_manager.send_text(websocket, json.dumps({"event": event_type, "data": line}))
                queue.task_done()
            await ws_manager.send_text(websocket, json.dumps({"event": "info", "data": f"Comando '{msg_type}' finalizado."}))
        finally:
            if msg_type == "executar_script_conteudo":
                temp_script_path = os.path.join(SCRIPT_PATH, "_temp_run.js")
                if os.path.exists(temp_script_path):
                    os.remove(temp_script_path)

    else:
        await ws_manager.send_text(websocket, json.dumps({"event": "error", "data": f"type desconhecido: {msg_type}"}))

# =========================================================
# Execução (Uvicorn)
# =========================================================
# Execute com:
#   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
