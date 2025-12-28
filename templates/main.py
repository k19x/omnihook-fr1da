import subprocess
import re
import shlex
from typing import List, Literal, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="OmniHook Fr1da Backend",
    description="API para gerenciar interações com dispositivos Android via ADB e Frida.",
    version="1.0.0",
)

# --- Modelos de Dados (Pydantic) ---

class BrowseRequest(BaseModel):
    device: str = Field(..., description="O ID do dispositivo (serial).")
    path: str = Field(..., description="O caminho absoluto a ser explorado no dispositivo.")

class FileInfo(BaseModel):
    name: str
    type: Literal["directory", "file", "symlink", "other"]
    size: int
    permissions: str
    last_modified: str
    symlink_target: Optional[str] = None


# --- Funções Auxiliares ---

def _parse_ls_line(line: str) -> Optional[FileInfo]:
    """
    Analisa uma única linha da saída de 'ls -l' de forma robusta usando regex.
    Ex: drwxr-x--x  2 shell shell      4096 2024-01-15 13:30 data
    Ex: lrwxrwxrwx  1 root  root         21 2024-01-15 13:30 vendor -> /vendor
    """
    # Regex aprimorado para capturar os campos de forma mais segura
    pattern = re.compile(
        r"^(?P<perms>[dlbcps-])(?P<perms_rest>[\w-]{9})\s+"  # Permissões
        r"(?P<links>\d+)\s+"                                # Links
        r"(?P<user>[\w\d_-]+)\s+"                           # Usuário
        r"(?P<group>[\w\d_-]+)\s+"                          # Grupo
        r"(?P<size>\d+)\s+"                                 # Tamanho
        r"(?P<date>\d{4}-\d{2}-\d{2})\s+"                    # Data (YYYY-MM-DD)
        r"(?P<time>\d{2}:\d{2})\s+"                          # Hora (HH:MM)
        r"(?P<name>.*)$"                                    # Nome do arquivo (resto da linha)
    )
    match = pattern.match(line)
    if not match:
        return None

    data = match.groupdict()
    name = data["name"]
    symlink_target = None

    # Ignora os diretórios especiais '.' e '..'
    if name == '.' or name == '..':
        return None

    file_type_char = data["perms"]
    if file_type_char == 'd':
        file_type = "directory"
    elif file_type_char == 'l':
        file_type = "symlink"
        if ' -> ' in name:
            name, symlink_target = name.split(' -> ', 1)
    elif file_type_char == '-':
        file_type = "file"
    else:
        file_type = "other"

    return FileInfo(
        name=name,
        type=file_type,
        size=int(data["size"]),
        permissions=data["perms"] + data["perms_rest"],
        last_modified=f"{data['date']} {data['time']}",
        symlink_target=symlink_target,
    )

# --- Rotas da API ---

@app.post("/browse_files", response_model=List[FileInfo])
async def browse_files(req: BrowseRequest):
    """
    Lista arquivos e diretórios em um caminho específico de um dispositivo Android via ADB.
    Esta versão é mais segura e robusta.
    """
    if not req.device:
        raise HTTPException(status_code=400, detail="ID do dispositivo não fornecido.")
    if not req.path or not req.path.startswith('/'):
        raise HTTPException(status_code=400, detail="Caminho inválido. Deve ser um caminho absoluto.")

    # 1. Melhoria de Segurança: Escapa o caminho para prevenir Shell Injection.
    safe_path = shlex.quote(req.path)
    
    # 2. Melhoria de Robustez: Usa 'ls' com flags que padronizam a saída.
    #    -l: formato longo
    #    -a: mostra arquivos ocultos (incluindo . e .. que serão filtrados)
    #    --full-time: formato de data/hora mais fácil de analisar (embora usemos um regex flexível)
    command = ["adb", "-s", req.device, "shell", f"ls -la {safe_path}"]

    try:
        result = subprocess.run(
            command, capture_output=True, text=True, check=True, encoding='utf-8', errors='ignore'
        )
        
        lines = result.stdout.strip().splitlines()
        # Filtra linhas inválidas e mapeia para o objeto FileInfo
        files = [f for line in lines if (f := _parse_ls_line(line)) is not None]
        return files

    except subprocess.CalledProcessError as e:
        error_message = e.stderr.strip()
        if "No such file or directory" in error_message or "Not a directory" in error_message:
            raise HTTPException(status_code=404, detail=f"Caminho não encontrado ou inválido: {req.path}")
        raise HTTPException(status_code=500, detail=f"Erro no ADB: {error_message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro inesperado no servidor: {str(e)}")