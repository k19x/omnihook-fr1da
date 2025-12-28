/**
 * OmniHook Fr1da - Script Principal Unificado
 * Contém: WebSocket, Logger, Abas, Explorador de Arquivos, ADB, Proxy e Temas.
 */

"use strict";

/* ==================== CONFIG & STATE ==================== */
const API_BASE = `${location.protocol}//${location.host}`;
const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

let ws = null, wsReady = false, wsQueue = [];
let insightsTimer = null;
let logEl = null, gutterEl = null, logLineCounter = 0;
let currentExplorerPath = '/';
let editor = null;
let jadxEditor = null;

/* ==================== 1. HELPERS GLOBAIS ==================== */

// Retorna o ID do dispositivo selecionado ou null
function getSelectedDevice() {
    const el = document.getElementById("dispositivos");
    return el && el.value ? el.value : null;
}

// Retorna o nome do pacote selecionado ou null
function getSelectedPackage() {
    const el = document.getElementById("pacotes");
    return el && el.value ? el.value : null;
}


// Formata bytes para tamanho legível (Explorador)
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '—';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/* ==================== 2. CONSOLE & LOGGER ==================== */

function appendLineNumbers(n) {
    if (!gutterEl) return;
    const start = logLineCounter + 1;
    const end = logLineCounter + n;
    let buf = '';
    for (let i = start; i <= end; i++) {
        buf += i + '\n';
    }
    gutterEl.textContent += buf;
    logLineCounter += n;
}

function adicionarLog(msg, tipo = "info") {
    if (!logEl) return;
    const ts = new Date().toLocaleTimeString();
    const messageText = String(msg ?? "");
    
    // Calcula linhas baseado em quebras de linha explícitas
    const lineCount = (messageText.match(/\n/g) || []).length + 1;

    // Adiciona o texto
    // Nota: Usamos append para performance em logs longos
    logEl.textContent += `[${ts}] [${tipo}] ${messageText}\n`;
    appendLineNumbers(lineCount);

    // Auto-scroll (ajustado para o container pai flexível)
    // O container de scroll é o pai direto do #log e #log-gutter
    const container = logEl.parentElement; 
    if(container) {
        container.scrollTop = container.scrollHeight;
    }
}

/* ==================== 3. WEBSOCKET ==================== */

function connectWS() {
    try { 
        ws = new WebSocket(WS_URL); 
    } catch (e) { 
        adicionarLog(`WS init error: ${e}`, "error"); 
        return; 
    }

    ws.onopen = () => { 
        wsReady = true; 
        adicionarLog("WebSocket conectado.", "success"); 
        while (wsQueue.length) ws.send(JSON.stringify(wsQueue.shift())); 
        
        // Atualiza status na UI se houver
        const dot = document.querySelector('footer .bg-green-500');
        if(dot) dot.classList.replace('bg-red-500', 'bg-green-500');
    };

    ws.onclose = () => { 
        wsReady = false; 
        adicionarLog("WebSocket fechado. Reconnect em 1s...", "warn"); 
        
        const dot = document.querySelector('footer .bg-green-500');
        if(dot) dot.classList.replace('bg-green-500', 'bg-red-500');

        setTimeout(connectWS, 1000); 
    };

    ws.onerror = (e) => adicionarLog(`WebSocket erro: ${e?.message || "desconhecido"}`, "error");

    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg && typeof msg.event === "string") {
                if (msg.event === 'logcat_data') {
                    const logcatEl = document.getElementById('logcat-log');
                    if (logcatEl) {
                        logcatEl.textContent += msg.data + '\n';
                        logcatEl.scrollTop = logcatEl.scrollHeight;
                    }
                } else {
                    const level = msg.event === "error" ? "error" : (msg.event === "log" ? "log" : "info");
                    adicionarLog(String(msg.data ?? ""), level);
                }
            } else {
                adicionarLog(ev.data, "log");
            }
        } catch { 
            adicionarLog(ev.data, "log"); 
        }
    };
}

function wsSend(obj) {
    if (wsReady && ws && ws.readyState === 1) {
        ws.send(JSON.stringify(obj));
    } else { 
        wsQueue.push(obj); 
        adicionarLog("WS nao esta pronto; comando enfileirado.", "warn"); 
    }
}

/* ==================== 4. TEMA (THEME) ==================== */

(function themeInit() {
    const STORAGE_KEY = "omnihook.theme";
    const media = window.matchMedia("(prefers-color-scheme: light)");
    
    function setIcon(theme, eff) {
        const btn = document.getElementById("themeToggleBtn");
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (!icon) return;

        // Atualiza classes do ícone preservando outras (ex: text-xl)
        icon.classList.remove("fa-desktop", "fa-sun", "fa-moon");
        icon.classList.add("fa-solid");

        if (theme === "auto") icon.classList.add("fa-desktop");
        else if (eff === "light") icon.classList.add("fa-sun");
        else icon.classList.add("fa-moon");
    }

    function apply(theme) {
        const eff = theme === "auto" ? (media.matches ? "light" : "dark") : theme;
        if (eff === "light") document.documentElement.setAttribute("data-theme", "light");
        else document.documentElement.removeAttribute("data-theme");
        
        localStorage.setItem(STORAGE_KEY, theme);
        setIcon(theme, eff);
    }

    const saved = localStorage.getItem(STORAGE_KEY) || "auto"; 
    apply(saved);

    media.addEventListener?.("change", () => { 
        if ((localStorage.getItem(STORAGE_KEY) || "auto") === "auto") apply("auto"); 
    });

    function initThemeUI() {
        // Garante que o ícone e o tema estejam sincronizados após o carregamento do DOM
        apply(localStorage.getItem(STORAGE_KEY) || "auto");

        document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
            const cur = localStorage.getItem(STORAGE_KEY) || "auto";
            apply(cur === "auto" ? "light" : (cur === "light" ? "dark" : "auto"));
        });
    }

    if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", initThemeUI);
    else initThemeUI();
})();

/* ==================== 5. ADB & SCRIPTS HELPERS ==================== */

async function carregarPacotes(dispositivo_id) {
    const select = document.getElementById("pacotes"); 
    if (!select) return;
    
    select.innerHTML = '<option value="">Carregando...</option>';
    try {
        const res = await fetch("/listar_pacotes", { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ dispositivo_id }) 
        });
        const data = await res.json();
        
        select.innerHTML = ''; // Limpa loading
        if (Array.isArray(data) && data.length) {
            data.forEach(pkg => { 
                const pkgName = pkg.id || pkg; // Suporte a objeto ou string legado
                const o = document.createElement("option"); 
                o.value = pkgName; 
                o.textContent = pkgName; 
                select.appendChild(o); 
            });
            select.selectedIndex = 0; 
            adicionarLog(`[PACOTES] ${data.length} carregado(s).`);
        } else {
            const o = document.createElement("option"); 
            o.value = ""; o.textContent = "Nenhum pacote encontrado"; select.appendChild(o);
            adicionarLog(`[PACOTES] Nenhum pacote encontrado para ${dispositivo_id}.`);
        }
    } catch (e) { 
        select.innerHTML = '<option value="">Erro</option>';
        adicionarLog(`[ERRO PACOTES] ${e}`, "error"); 
    }
}

async function carregarScriptsAuto() {
    const select = document.getElementById("scripts"); 
    if (!select) return;
    
    select.innerHTML = '<option value="">Selecionar script</option>';
    try {
        const res = await fetch("/listar_scripts"); 
        const data = await res.json();
        const up = document.getElementById("adicionarScriptBtn");
        
        if (Array.isArray(data) && data.length) {
            data.forEach(s => { 
                const o = document.createElement("option"); 
                o.value = s; 
                o.textContent = s; 
                select.appendChild(o); 
            });
            if (up) up.disabled = false; 
            // adicionarLog(`[SCRIPTS] ${data.length} carregado(s).`); // Verbose demais
        } else { 
            if (up) up.disabled = true; 
            adicionarLog("[SCRIPTS] Nenhum script encontrado na pasta.", "warn"); 
        }
    } catch (e) { 
        adicionarLog(`[ERRO SCRIPTS] ${e}`, "error"); 
    }
}

function atualizarEstadoExecucao() {
    const dispositivo = getSelectedDevice();
    const pacote = getSelectedPackage();
    const temScripts = document.querySelectorAll("#scriptsSelecionados li").length > 0;
    const hasPackage = !!(dispositivo && pacote);

    // Habilita botões de Deep Link
    document.querySelectorAll("#extract-main-activity-btn, #extract-all-activities-btn, #send-deeplink-btn").forEach(b => b.disabled = !hasPackage);
    
    // Habilita botão Executar Frida
    const fridaBtn = document.getElementById("executarBtn"); 
    if (fridaBtn) fridaBtn.disabled = !(hasPackage && temScripts);
}


/* ==================== 6. INSIGHTS TELEMETRY ==================== */

function humanUptime(s) { 
    if (!s || s < 0) return "—"; 
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); 
    return [d ? `${d}d` : "", h ? `${h}h` : "", (m || (!d && !h)) ? `${m}m` : ""].filter(Boolean).join(" "); 
}

function renderInsights(data) {
    const q = id => document.getElementById(id);
    q("d-name") && (q("d-name").textContent = data?.nome ?? "—");
    q("d-android") && (q("d-android").textContent = data?.android ?? "—");
    q("d-sdk") && (q("d-sdk").textContent = data?.sdk ?? "—");
    q("d-cpu") && (q("d-cpu").textContent = data?.cpu_abi ?? "—");
    
    if(q("d-root")) {
        q("d-root").textContent = data?.root ? "Sim" : "Não";
        q("d-root").className = `insight-val ${data?.root ? 'text-red-400 font-bold' : 'text-gray-400'}`;
    }
    
    if(q("d-frida")) {
        q("d-frida").textContent = data?.frida_running ? "Rodando" : "Inativo";
        q("d-frida").className = `insight-val ${data?.frida_running ? 'text-green-400' : 'text-gray-500'}`;
    }

    const lvl = data?.bateria?.level ?? "—", tmp = data?.bateria?.temp_c ?? "—";
    q("d-batt") && (q("d-batt").textContent = lvl);
    q("d-temp") && (q("d-temp").textContent = tmp);
    q("d-ip") && (q("d-ip").textContent = data?.wifi_ip || "—");

    // Security Insights
    if (q("d-dev-mode")) {
        q("d-dev-mode").textContent = data?.developer_mode ? "Ativo" : "Inativo";
        q("d-dev-mode").className = `insight-val ${data?.developer_mode ? 'text-yellow-400' : 'text-gray-400'}`;
    }
    if (q("d-crypto")) {
        q("d-crypto").textContent = data?.encryption_status ?? "—";
        q("d-crypto").className = `insight-val ${data?.encryption_status === 'Criptografado' ? 'text-green-400' : 'text-red-400'}`;
    }
    if (q("d-screenlock")) {
        q("d-screenlock").textContent = data?.screen_lock ? "Ativo" : "Inativo";
        q("d-screenlock").className = `insight-val ${data?.screen_lock ? 'text-green-400' : 'text-red-400'}`;
    }
    if (q("d-user-certs")) {
        q("d-user-certs").textContent = data?.user_certs > 0 ? `${data.user_certs} instalado(s)` : "Nenhum";
        q("d-user-certs").className = `insight-val ${data?.user_certs > 0 ? 'text-yellow-400' : 'text-gray-400'}`;
    }
    
    const dot = document.getElementById("d-online-dot"); 
    if (dot) { 
        dot.style.opacity = 1; 
        dot.className = (lvl !== "—") ? "w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" : "w-2 h-2 rounded-full bg-gray-600";
    }
}

async function fetchInsightsOnce(deviceId) {
    try {
        const res = await fetch("/device_insights", { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ dispositivo_id: deviceId }) 
        });
        if (!res.ok) throw new Error(`${res.status}`);
        renderInsights(await res.json());
    } catch (e) { 
        // Silencioso para não spammar logs em caso de erro de polling
    }
}

function startInsightsPolling(deviceId) { 
    stopInsightsPolling(); 
    if (!deviceId) return; 
    fetchInsightsOnce(deviceId); 
    insightsTimer = setInterval(() => fetchInsightsOnce(deviceId), 5000); 
}

function stopInsightsPolling() { 
    if (insightsTimer) { 
        clearInterval(insightsTimer); 
        insightsTimer = null; 
    } 
}

/* ==================== 7. FILE EXPLORER LOGIC ==================== */

async function browsePath(path) {
    const deviceId = getSelectedDevice();
    if (!deviceId) return; 

    const explorerBody = document.getElementById('file-explorer-body');
    if(!explorerBody) return;

    currentExplorerPath = path;
    
    const breadcrumb = document.getElementById('file-explorer-breadcrumb');
    breadcrumb.innerHTML = '';
    
    const rootLink = document.createElement('span');
    rootLink.className = 'cursor-pointer hover:text-primary hover:underline font-mono';
    rootLink.textContent = '/';
    rootLink.onclick = () => browsePath('/');
    breadcrumb.appendChild(rootLink);

    const parts = path.split('/').filter(p => p);
    let buildPath = '';
    parts.forEach(part => {
        buildPath += '/' + part;
        const currentClick = buildPath;
        
        const sep = document.createTextNode(' / ');
        breadcrumb.appendChild(sep);
        
        const partLink = document.createElement('span');
        partLink.className = 'cursor-pointer hover:text-primary hover:underline font-mono';
        partLink.textContent = part;
        partLink.onclick = () => browsePath(currentClick);
        breadcrumb.appendChild(partLink);
    });

    explorerBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</td></tr>';

    try {
        const response = await fetch('/browse_files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device: deviceId, path: path })
        });
        
        if (!response.ok) throw new Error((await response.json()).detail || 'Falha ao listar arquivos');
        
        const files = await response.json();
        explorerBody.innerHTML = '';

        if (files.length === 0) {
            explorerBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-muted text-xs">Pasta vazia</td></tr>';
            return;
        }

        files.forEach(file => {
            const fullPath = (path === '/' ? '' : path) + '/' + file.name;
            const row = document.createElement('tr');
            row.className = 'hover:bg-bg-hover transition-colors group';
            row.dataset.name = file.name.toLowerCase();
            
            const iconClass = file.type === 'directory' ? 'fa-solid fa-folder text-yellow-400' : 
                              (file.type === 'symlink' ? 'fa-solid fa-link text-cyan-400' : 'fa-solid fa-file-lines text-gray-400');
            
            row.innerHTML = `
                <td class="p-3 text-center"><i class="${iconClass}"></i></td>
                <td class="p-3 font-medium text-txt truncate max-w-[200px]">
                    <span class="${file.type === 'directory' ? 'cursor-pointer hover:text-primary hover:underline' : ''}" 
                          onclick="${file.type === 'directory' ? `browsePath('${fullPath.replace(/'/g, "\\'")}')` : ''}">
                        ${file.name}
                    </span>
                    ${file.symlink_target ? `<span class="text-xs text-muted ml-2">→ ${file.symlink_target}</span>` : ''}
                </td>
                <td class="p-3 text-muted text-xs">${formatBytes(file.size)}</td>
                <td class="p-3 text-muted text-xs whitespace-nowrap font-mono">${file.last_modified || '-'}</td>
                <td class="p-3 text-muted font-mono text-xs hidden md:table-cell">${file.permissions || '-'}</td>
                <td class="p-3 text-right">
                    <div class="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        ${file.type === 'file' ? `<button onclick="downloadFile('${fullPath.replace(/'/g, "\\'")}', '${file.name.replace(/'/g, "\\'")}')" class="text-muted hover:text-primary" title="Baixar"><i class="fa-solid fa-download"></i></button>` : ''}
                        <button onclick="renameFile('${fullPath.replace(/'/g, "\\'")}', '${file.name.replace(/'/g, "\\'")}')" class="text-muted hover:text-yellow-400" title="Renomear"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteFile('${fullPath.replace(/'/g, "\\'")}', '${file.name.replace(/'/g, "\\'")}')" class="text-muted hover:text-red-400" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            explorerBody.appendChild(row);
        });
    } catch (error) {
        explorerBody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-400 text-xs">Erro: ${error.message}</td></tr>`;
    }
}

// Ações Globais do Explorador (para funcionar no HTML injetado)
window.downloadFile = async (path, name) => {
    try {
        const res = await fetch('/download_file', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ device: getSelectedDevice(), path })
        });
        if(!res.ok) throw new Error("Erro download");
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { alert("Falha ao baixar arquivo."); }
};

window.deleteFile = async (path, name) => {
    if(!confirm(`Excluir permanentemente "${name}"?`)) return;
    try {
        await fetch('/delete_file', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ device: getSelectedDevice(), path })
        });
        browsePath(currentExplorerPath);
    } catch (e) { alert("Falha ao excluir."); }
};

window.renameFile = async (path, oldName) => {
    const newName = prompt("Novo nome:", oldName);
    if(!newName || newName === oldName) return;
    try {
        await fetch('/rename_file', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ device: getSelectedDevice(), old_path: path, new_name: newName })
        });
        browsePath(currentExplorerPath);
    } catch (e) { alert("Falha ao renomear."); }
};

/* ==================== 8. MAIN UI INITIALIZATION ==================== */

function setupRightSidebarTabs() {
    const tabButtons = document.querySelectorAll('.right-sidebar-tab');
    const panels = document.querySelectorAll('.right-sidebar-panel');
    const mirrorImg = document.getElementById('mirror-stream-img');
    const stopMirrorBtn = document.getElementById('stop-mirror-btn');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.tab;

            tabButtons.forEach(b => b.dataset.active = 'false');
            panels.forEach(p => {
                p.dataset.active = 'false';
                p.classList.add('hidden');
            });

            btn.dataset.active = 'true';
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) {
                targetPanel.classList.remove('hidden');
                targetPanel.dataset.active = 'true';
            }

            // Lógica de Espelhamento no Navegador
            if (targetId === 'device-right-panel') {
                const dev = getSelectedDevice();
                if (dev && mirrorImg) {
                    // Adiciona timestamp para evitar cache do navegador
                    mirrorImg.src = `/video_feed/${dev}?t=${Date.now()}`;
                    mirrorImg.classList.remove('hidden');
                    if (stopMirrorBtn) stopMirrorBtn.classList.remove('hidden');
                } else if (mirrorImg) {
                    mirrorImg.alt = "Selecione um dispositivo para iniciar.";
                }
            } else {
                // Para o stream ao mudar de aba para economizar banda/cpu
                if (mirrorImg) {
                    mirrorImg.src = "";
                    mirrorImg.removeAttribute("src");
                }
                if (stopMirrorBtn) stopMirrorBtn.classList.add('hidden');
            }
        });
    });

    // Botão manual de parar
    if (stopMirrorBtn) {
        stopMirrorBtn.addEventListener('click', () => {
            if (mirrorImg) mirrorImg.src = "";
            stopMirrorBtn.classList.add('hidden');
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    logEl = document.getElementById("log");
    gutterEl = document.getElementById("log-gutter");
    
    // Inicia WS e carrega scripts iniciais
    connectWS();
    carregarScriptsAuto();

    // --- TAB SYSTEM (Navegação) ---
    const tabButtons = document.querySelectorAll('.btn-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.tab;

            tabButtons.forEach(b => b.dataset.active = 'false');
            panels.forEach(p => {
                p.dataset.active = 'false';
                p.classList.add('hidden');
            });

            btn.dataset.active = 'true';
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) {
                targetPanel.classList.remove('hidden');
                targetPanel.dataset.active = 'true';
                
                if (targetId === 'explorer-panel' && getSelectedDevice()) {
                    browsePath(currentExplorerPath || '/');
                }
                if (targetId === 'apps-panel') {
                    loadAppsGrid();
                }
                if (targetId === 'gallery-panel') {
                    loadGallery();
                }
                if (targetId === 'editor-panel' && editor) {
                    setTimeout(() => {
                        editor.refresh();
                        editor.setSize("100%", "100%");
                    }, 100);
                }
                if (targetId === 'jadx-panel') {
                    loadJadxProjects();
                    setTimeout(() => {
                        if (jadxEditor) jadxEditor.refresh();
                    }, 100);
                }
            }
        });
    });

    // --- DEVICE MANAGEMENT ---
    document.getElementById("listarDispositivosBtn")?.addEventListener("click", () => {
        fetch("/listar_dispositivos").then(r => r.json()).then(data => {
            const select = document.getElementById("dispositivos"); 
            if (!select) return;
            select.innerHTML = '<option value="">Selecionar dispositivo</option>';
            (data || []).forEach(d => { 
                const o = document.createElement("option"); 
                o.value = d.id; 
                o.textContent = `${d.name} (${d.conexao})`; 
                select.appendChild(o); 
            });
            adicionarLog(data?.length ? `[DISPOSITIVOS] ${data.length} encontrado(s).` : "[DISPOSITIVOS] Nenhum encontrado.");
        }).catch(e => adicionarLog(`[ERRO DISPOSITIVOS] ${e}`, "error"));
    });

    document.getElementById("dispositivos")?.addEventListener("change", async function () {
        const dev = this.value.trim();
        
        const idsToToggle = ["ativarTcpipBtn", "statusConexaoBtn", "reiniciarFridaBtn", "listarPacotesBtn", "listarScriptsBtn", "upload-file-btn", "install-apk-btn"];
        idsToToggle.forEach(id => { 
            const b = document.getElementById(id); 
            if (b) b.disabled = !dev; 
        });

        if (!dev) { 
            stopInsightsPolling(); 
            renderInsights({});
            atualizarEstadoExecucao(); 
            return; 
        }

        adicionarLog(`[INFO] Dispositivo ${dev} selecionado.`);
        await Promise.all([carregarPacotes(dev), carregarScriptsAuto()]);
        startInsightsPolling(dev);
        atualizarEstadoExecucao();
        refreshProxyButtonsState();

        if (document.getElementById('explorer-panel')?.dataset.active === 'true') browsePath('/');
        if (document.getElementById('apps-panel')?.dataset.active === 'true') loadAppsGrid();
    });

    // --- ADB TOOLS EVENTS ---
    const handleAdbAction = (btnId, endpoint, bodyFn, label) => {
        document.getElementById(btnId)?.addEventListener("click", () => {
            const dev = getSelectedDevice();
            if(!dev) return;
            fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFn(dev)) })
                .then(r => r.json()).then(d => adicionarLog(`[${label}] ${d.mensagem || d.detail || JSON.stringify(d)}`))
                .catch(e => adicionarLog(`[ERRO ${label}] ${e}`, "error"));
        });
    };

    handleAdbAction("ativarTcpipBtn", "/ativar_tcpip", dev => ({ dispositivo_id: dev }), "TCP/IP");
    handleAdbAction("statusConexaoBtn", "/status_conexao", dev => ({ dispositivo_id: dev }), "STATUS");
    handleAdbAction("reiniciarFridaBtn", "/reiniciar_frida", dev => ({ dispositivo_id: dev }), "FRIDA");
    
    document.getElementById("screenshotBtn")?.addEventListener("click", () => {
        const dev = getSelectedDevice(); if (!dev) return adicionarLog("[ERRO] Nenhum dispositivo.", "error");
        fetch("/screenshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: dev }) })
            .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
            .then(d => { 
                adicionarLog(`[SCREENSHOT] ${d.message}`);
                if (document.getElementById('gallery-panel')?.dataset.active === 'true') {
                    loadGallery();
                }
            })
            .catch(e => adicionarLog(`[ERRO SCREENSHOT] ${e}`, "error"));
    });
    
    document.getElementById("mirrorBtn")?.addEventListener("click", () => {
        const dev = getSelectedDevice();
        if (!dev) {
            adicionarLog("[ERRO] Nenhum dispositivo selecionado para o espelhamento.", "error");
            return;
        }
        adicionarLog("[MIRROR] Iniciando scrcpy em uma nova janela...", "info");
        fetch("/mirror", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_id: dev })
        })
        .then(res => res.json())
        .then(data => {
            if (data.message) {
                adicionarLog(`[MIRROR] ${data.message}`, "success");
            } else {
                throw new Error(data.detail || "Erro desconhecido");
            }
        })
        .catch(e => adicionarLog(`[ERRO MIRROR] ${e.message}`, "error"));
    });

    // --- FRIDA & PACKAGES ---
    document.getElementById("listarPacotesBtn")?.addEventListener("click", () => { 
        const dev = getSelectedDevice(); 
        if(dev) carregarPacotes(dev); 
    });
    
    document.getElementById("listarScriptsBtn")?.addEventListener("click", carregarScriptsAuto);
    document.getElementById("pacotes")?.addEventListener("change", atualizarEstadoExecucao);

    document.getElementById("adicionarScriptBtn")?.addEventListener("click", () => {
        const sel = document.getElementById("scripts")?.value; 
        if (!sel) return;
        const lista = document.getElementById("scriptsSelecionados");
        if (Array.from(lista.children).some(li => li.firstChild?.textContent === sel)) return;

        const li = document.createElement("li"); 
        li.className = "bg-panel border border-border-color rounded px-2 py-1 text-xs flex items-center gap-2";
        li.innerHTML = `<span>${sel}</span><i class="fa-solid fa-xmark text-red-400 cursor-pointer hover:text-red-300"></i>`;
        li.querySelector('i').addEventListener("click", () => { lista.removeChild(li); atualizarEstadoExecucao(); });
        lista.appendChild(li); 
        atualizarEstadoExecucao();
    });

    document.getElementById("executarBtn")?.addEventListener("click", () => {
        const scripts = Array.from(document.querySelectorAll("#scriptsSelecionados li span")).map(s => s.textContent);
        if (!getSelectedDevice() || !getSelectedPackage() || scripts.length === 0) return adicionarLog("[ERRO] Faltam dados para execução.", "error");
        
        wsSend({ 
            type: "executar_comando", 
            dispositivo_id: getSelectedDevice(), 
            pacote: getSelectedPackage(), 
            scripts, 
            forma: document.querySelector('input[name="forma"]:checked')?.value 
        }); 
        adicionarLog(`[CMD] Iniciando Frida em ${getSelectedPackage()}...`);
    });

    // --- CONSOLE CONTROLS ---
    document.getElementById("clearLogBtn")?.addEventListener("click", () => { 
        if (logEl) logEl.textContent = ""; 
        if (gutterEl) gutterEl.textContent = ""; 
        logLineCounter = 0; 
    });
    
    document.getElementById("saveLogBtn")?.addEventListener("click", () => {
        const conteudo = (logEl?.innerText || "").trim(); 
        if (!conteudo) return;
        const nome = `omnihook_log_${Date.now()}.txt`; 
        const blob = new Blob([conteudo], { type: "text/plain" }); 
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); 
        URL.revokeObjectURL(a.href);
    });
    
    document.getElementById("refreshBtn")?.addEventListener("click", () => location.reload());

    // --- EXPLORER UPLOAD & SEARCH ---
    document.getElementById('explorer-search-input')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('#file-explorer-body tr').forEach(row => {
            row.style.display = (row.dataset.name || '').includes(term) ? '' : 'none';
        });
    });

    const uploadBtn = document.getElementById('upload-file-btn');
    if(uploadBtn) {
        const fileInput = document.createElement('input'); 
        fileInput.type = 'file'; 
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            if(e.target.files.length === 0) return;
            const formData = new FormData();
            formData.append('device', getSelectedDevice());
            formData.append('path', currentExplorerPath);
            formData.append('file', e.target.files[0]);
            
            const originalHtml = uploadBtn.innerHTML;
            uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await fetch('/upload_file', { method: 'POST', body: formData });
                browsePath(currentExplorerPath);
            } catch (err) { alert('Erro upload: ' + err); }
            finally { 
                uploadBtn.innerHTML = originalHtml;
                fileInput.value = '';
            }
        });
    }

    // --- APK INSTALL ---
    const installApkBtn = document.getElementById('install-apk-btn');
    if (installApkBtn) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.apk';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        installApkBtn.addEventListener('click', () => {
            if (installApkBtn.disabled) return;
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const device = getSelectedDevice();
            if (!device) {
                adicionarLog("[ERRO] Nenhum dispositivo selecionado para instalar o APK.", "error");
                return;
            }

            const formData = new FormData();
            formData.append('device', device);
            formData.append('file', file);

            const originalHtml = installApkBtn.innerHTML;
            installApkBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando...';
            installApkBtn.disabled = true;

            adicionarLog(`[INFO] Instalando ${file.name} em ${device}... Isso pode demorar.`);

            try {
                const response = await fetch('/install_apk', {
                    method: 'POST',
                    body: formData,
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || 'Erro desconhecido durante a instalação.');
                }
                adicionarLog(`[SUCCESS] ${data.message}`, 'success');
                // Recarrega a lista de apps para mostrar o novo app instalado
                setTimeout(() => loadAppsGrid(), 1000);
            } catch (error) {
                adicionarLog(`[ERRO] Falha na instalação: ${error.message}`, 'error');
            } finally {
                installApkBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Instalar APK';
                installApkBtn.disabled = !getSelectedDevice();
                fileInput.value = ''; // Limpa o input para permitir a seleção do mesmo arquivo novamente
            }
        });
    }

    // --- PROXY, APPS, MANIFEST UI ---
    wireProxyUI();
    document.getElementById('apps-search')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.app-card').forEach(card => {
            card.style.display = (card.dataset.name || '').includes(term) ? 'flex' : 'none';
        });
    });
    document.getElementById('apps-filter')?.addEventListener('change', () => loadAppsGrid());
    setupAppContextMenu();
    setupManifestModal();
    setupAiModal();
    setupRunWithScriptModal();
    setupTerminal();
    setupGallery();
    setupRightSidebarTabs();
    setupScriptEditor();
    setupJadxUI();
    setupLayoutToggles();
});

/* ==================== 9. PROXY LOGIC ==================== */

function refreshProxyButtonsState() {
    const dev = getSelectedDevice();
    const ip = document.getElementById("proxy-ip")?.value.trim();
    const pt = document.getElementById("proxy-port")?.value.trim();
    const ok = !!dev && validateIPv4(ip) && validatePort(pt);
    
    const setBtn = document.getElementById("setProxyBtn");
    if (setBtn) setBtn.disabled = !ok;
}

function validateIPv4(ip) { return /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip || ""); }
function validatePort(p) { const n = Number(p); return Number.isInteger(n) && n >= 1 && n <= 65535; }

function wireProxyUI() {
    const ipEl = document.getElementById("proxy-ip");
    const portEl = document.getElementById("proxy-port");
    if(!ipEl || !portEl) return;

    ipEl.addEventListener("input", refreshProxyButtonsState);
    portEl.addEventListener("input", refreshProxyButtonsState);

    document.getElementById("proxyToggle")?.addEventListener("change", async (ev) => {
        if (ev.target.checked) {
            const ip = ipEl.value.trim();
            const pt = portEl.value.trim();
            if (!validateIPv4(ip) || !validatePort(pt)) { 
                ev.target.checked = false; 
                return alert("IP ou Porta inválidos"); 
            }
            await setProxyAction(ip, pt);
        } else {
            await clearProxyAction();
        }
    });

    document.getElementById("setProxyBtn")?.addEventListener("click", () => setProxyAction(ipEl.value, portEl.value));
    document.getElementById("getProxyBtn")?.addEventListener("click", getProxyAction);
    document.getElementById("clearProxyBtn")?.addEventListener("click", clearProxyAction);
    document.getElementById("copyBurpIpBtn")?.addEventListener("click", async () => {
        try {
            const ip = await fetch("https://api.ipify.org/?format=text").then(r => r.text());
            await navigator.clipboard.writeText(ip);
            adicionarLog(`[PROXY] IP Copiado: ${ip}`);
        } catch { adicionarLog("[PROXY] Erro ao copiar IP", "warn"); }
    });
}

async function setProxyAction(ip, port) {
    const device = getSelectedDevice();
    if (!device) return;
    try {
        const res = await fetch("/set_proxy", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device, ip, port })
        });
        const data = await res.json();
        adicionarLog(`[PROXY] ${data.mensagem || data.erro || "Definido"}`);
        const chk = document.getElementById("proxyToggle");
        if(chk) chk.checked = true;
    } catch (e) { adicionarLog(`[ERRO PROXY] ${e}`, "error"); }
}

async function clearProxyAction() {
    const device = getSelectedDevice();
    if (!device) return;
    try {
        const res = await fetch("/clear_proxy", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device })
        });
        const data = await res.json();
        adicionarLog(`[PROXY] ${data.mensagem || data.erro}`);
        const chk = document.getElementById("proxyToggle");
        if(chk) chk.checked = false;
    } catch (e) { adicionarLog(`[ERRO PROXY] ${e}`, "error"); }
}

async function getProxyAction() {
    const device = getSelectedDevice();
    if (!device) return;
    try {
        const res = await fetch("/get_proxy", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device })
        });
        const data = await res.json();
        const p = data.proxy || "—";
        adicionarLog(`[PROXY] Atual: ${p}`);
        
        const chk = document.getElementById("proxyToggle");
        if(chk) chk.checked = (p !== "—" && p !== ":0" && !p.includes("null"));
        
        if (p.includes(":")) {
            const [ip, port] = p.split(":");
            if(document.getElementById("proxy-ip")) document.getElementById("proxy-ip").value = ip;
            if(document.getElementById("proxy-port")) document.getElementById("proxy-port").value = port;
        }
    } catch (e) { adicionarLog(`[ERRO PROXY] ${e}`, "error"); }
}

/* ==================== 10. APPS GRID SYSTEM ==================== */

function createAppCard(pkgObj, dev, forceRefresh) {
    const pkg = pkgObj.id;
    const type = pkgObj.type;
    const label = pkgObj.label || pkg;
    const card = document.createElement('div');
    card.className = 'app-card flex flex-col items-center justify-center p-4 bg-panel border border-border-color rounded-lg hover:border-primary hover:bg-bg-hover cursor-pointer transition-all group relative shadow-sm hover:shadow-md';
    card.dataset.name = `${pkg} ${label}`.toLowerCase();
    
    card.onclick = () => {
        const select = document.getElementById('pacotes');
        if (select) {
            select.value = pkg;
            select.dispatchEvent(new Event('change'));
            adicionarLog(`[APPS] Pacote selecionado: ${pkg}`);
            document.querySelectorAll('.app-card').forEach(c => c.classList.remove('ring-2', 'ring-primary'));
            card.classList.add('ring-2', 'ring-primary');
        }
    };

    card.oncontextmenu = (e) => {
        e.preventDefault();
        const menu = document.getElementById('app-context-menu');
        if (menu) {
            menu.dataset.package = pkg;
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            menu.classList.remove('hidden');
        }
    };
    
    const cacheBuster = forceRefresh ? `?refresh=true&t=${Date.now()}` : '';
    const badgeClass = type === 'system' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    const badgeLabel = type === 'system' ? 'SYS' : 'USER';

    card.innerHTML = `
        <div class="w-14 h-14 rounded-2xl bg-bg flex items-center justify-center mb-3 shadow-inner group-hover:scale-110 transition-transform duration-200 overflow-hidden app-icon-container transition-all duration-300">
            <img src="/app_icon/${dev}/${pkg}${cacheBuster}" alt="${pkg}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<i class=&quot;fa-brands fa-android text-4xl text-[#3DDC84]&quot;></i>'">
        </div>
        <div class="app-label text-xs text-center font-bold text-txt break-words line-clamp-2 w-full px-1 leading-tight mb-1 transition-all duration-300" title="${label}">
            ${label}
        </div>
        <div class="text-[10px] text-center font-mono text-muted truncate w-full opacity-60 transition-all duration-300 app-pkg-name">
            ${pkg}
        </div>
        <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold border ${badgeClass}">
            ${badgeLabel}
        </div>
        <button class="absolute top-2 right-2 text-muted hover:text-primary transition-colors z-10 toggle-visibility-btn p-1" title="Ofuscar/Mostrar">
            <i class="fa-solid fa-eye"></i>
        </button>
    `;

    const toggleBtn = card.querySelector('.toggle-visibility-btn');
    const iconContainer = card.querySelector('.app-icon-container');
    const labelEl = card.querySelector('.app-label');
    const pkgEl = card.querySelector('.app-pkg-name');
    const icon = toggleBtn.querySelector('i');

    toggleBtn.onclick = (e) => {
        e.stopPropagation(); // Impede que o clique selecione o card
        const isObfuscated = iconContainer.classList.contains('blur-md');
        
        if (isObfuscated) {
            iconContainer.classList.remove('blur-md', 'opacity-10');
            labelEl.classList.remove('blur-sm', 'opacity-10');
            pkgEl.classList.remove('blur-sm', 'opacity-10');
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        } else {
            iconContainer.classList.add('blur-md', 'opacity-10');
            labelEl.classList.add('blur-sm', 'opacity-10');
            pkgEl.classList.add('blur-sm', 'opacity-10');
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
    };

    fetch(`/app_label/${dev}/${pkg}`)
        .then(r => r.json())
        .then(d => {
            if (d.label && d.label !== pkg) {
                const labelEl = card.querySelector('.app-label');
                if (labelEl) {
                    labelEl.textContent = d.label;
                    labelEl.title = d.label;
                }
                card.dataset.name = `${pkg} ${d.label}`.toLowerCase();
            }
        });

    return card;
}

async function loadAppsGrid(forceRefresh = false) {
    const dev = getSelectedDevice();
    const grid = document.getElementById('apps-grid-container');
    if (!grid) return;
    
    const filter = document.getElementById('apps-filter')?.value || 'user';
    const defaultGridClass = "flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 content-start";
    grid.className = defaultGridClass;

    if (!dev) {
        grid.innerHTML = '<div class="col-span-full text-center text-muted mt-10">Selecione um dispositivo primeiro.</div>';
        return;
    }

    grid.innerHTML = '<div class="col-span-full text-center text-muted mt-10"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><br>Carregando pacotes...</div>';

    try {
        const res = await fetch("/listar_pacotes", { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ dispositivo_id: dev, filtro: filter }) 
        });
        const pacotes = await res.json();

        grid.innerHTML = '';
        if (!Array.isArray(pacotes) || pacotes.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center text-muted mt-10">Nenhum pacote encontrado.</div>';
            return;
        }

        if (filter === 'all') {
            grid.className = "flex-1 overflow-y-auto p-4 flex flex-col gap-8";
            const userPkgs = pacotes.filter(p => p.type !== 'system');
            const sysPkgs = pacotes.filter(p => p.type === 'system');

            const renderSection = (title, icon, pkgs) => {
                if (pkgs.length === 0) return;
                const section = document.createElement('div');
                section.innerHTML = `
                    <h4 class="font-bold text-txt mb-3 flex items-center gap-2 text-sm uppercase tracking-wider border-b border-border-color pb-2 sticky top-0 bg-bg/95 backdrop-blur z-10">
                        ${icon} ${title} <span class="bg-white/10 text-xs px-2 py-0.5 rounded-full ml-auto text-muted">${pkgs.length}</span>
                    </h4>
                    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 content-start section-grid"></div>
                `;
                grid.appendChild(section);
                const sectionGrid = section.querySelector('.section-grid');
                pkgs.forEach(pkgObj => sectionGrid.appendChild(createAppCard(pkgObj, dev, forceRefresh)));
            };

            renderSection("Aplicativos de Usuário", '<i class="fa-solid fa-user text-blue-400"></i>', userPkgs);
            renderSection("Aplicativos do Sistema", '<i class="fa-solid fa-microchip text-yellow-500"></i>', sysPkgs);
        } else {
            pacotes.forEach(pkgObj => grid.appendChild(createAppCard(pkgObj, dev, forceRefresh)));
        }
        
        adicionarLog(`[APPS] ${pacotes.length} aplicativos listados na grade.`);

    } catch (e) {
        grid.className = defaultGridClass;
        grid.innerHTML = `<div class="col-span-full text-center text-red-400 mt-10">Erro ao carregar: ${e.message}</div>`;
    }
}

function setupAppContextMenu() {
    if (document.getElementById('app-context-menu')) return;

    const menu = document.createElement('div');
    menu.id = 'app-context-menu';
    menu.className = 'fixed bg-panel border border-border-color rounded-lg shadow-2xl z-50 hidden flex-col min-w-[220px] py-1 backdrop-blur-md';
    menu.innerHTML = `
        <button data-action="launch" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-primary flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-rocket w-4 text-center"></i> Abrir App
        </button>
        <button data-action="run_with_script" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-cyan-400 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-file-code w-4 text-center"></i> Executar com Script
        </button>
        <div class="h-px bg-border-color/50 my-1 mx-2"></div>
        <button data-action="update" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-brand flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-rotate w-4 text-center"></i> Atualizar Info
        </button>
        <button data-action="backup" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-green-400 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-download w-4 text-center"></i> Backup APK
        </button>
        <button data-action="decompile" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-indigo-400 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-code-branch w-4 text-center"></i> Descompilar (JADX)
        </button>
        <button data-action="view_manifest" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-blue-400 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-eye w-4 text-center"></i> Visualizar Manifest
        </button>
        <button data-action="clear" class="text-left px-4 py-2.5 text-xs font-medium text-txt hover:bg-white/10 hover:text-yellow-400 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-eraser w-4 text-center"></i> Limpar Dados
        </button>
        <div class="h-px bg-border-color/50 my-1 mx-2"></div>
        <button data-action="uninstall" class="text-left px-4 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 flex items-center gap-3 transition-colors w-full">
            <i class="fa-solid fa-trash w-4 text-center"></i> Desinstalar
        </button>
    `;
    document.body.appendChild(menu);

    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const action = btn.dataset.action;
            const pkg = menu.dataset.package;
            const dev = getSelectedDevice();
            
            if (!pkg || !dev) return;

            if (action === 'uninstall' && !confirm(`Tem certeza que deseja desinstalar ${pkg}?`)) return;
            if (action === 'clear' && !confirm(`Limpar todos os dados de ${pkg}?`)) return;

            const actionHandlers = {
                'run_with_script': async () => {
                    const modal = document.getElementById('run-with-script-modal');
                    const scriptList = document.getElementById('run-with-script-list');
                    const packageNameEl = document.getElementById('run-with-script-package-name');
                    if (!modal || !scriptList || !packageNameEl) return;

                    packageNameEl.textContent = pkg;
                    modal.dataset.package = pkg;
                    modal.dataset.device = dev;

                    scriptList.innerHTML = '<div>Carregando...</div>';
                    try {
                        const res = await fetch('/listar_scripts');
                        const scripts = await res.json();
                        scriptList.innerHTML = ''; 

                        if (scripts && scripts.length > 0) {
                            scripts.forEach(scriptName => {
                                const item = document.createElement('div');
                                item.className = 'p-2 rounded-md hover:bg-cyan-500/10 cursor-pointer text-sm font-mono';
                                item.textContent = scriptName;
                                item.dataset.script = scriptName;
                                scriptList.appendChild(item);
                            });
                        } else {
                            scriptList.innerHTML = '<div class="text-muted text-sm">Nenhum script encontrado.</div>';
                        }
                    } catch (err) {
                        scriptList.innerHTML = `<div class="text-red-400 text-sm">Erro ao carregar: ${err.message}</div>`;
                    }
                    modal.classList.remove('hidden');
                    modal.classList.add('flex');
                },
                'update': async () => {
                    const card = Array.from(document.querySelectorAll('.app-card')).find(c => c.querySelector('.text-\\[10px\\]')?.textContent.trim() === pkg);
                    if (card) {
                        adicionarLog(`[APPS] Atualizando ícone e nome de ${pkg}...`);
                        const img = card.querySelector('img');
                        if (img) img.src = `/app_icon/${dev}/${pkg}?refresh=true&t=${Date.now()}`;
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        const labelRes = await fetch(`/app_label/${dev}/${pkg}`);
                        const labelData = await labelRes.json();
                        if (labelData.label) {
                            const labelEl = card.querySelector('.app-label');
                            if (labelEl) {
                                labelEl.textContent = labelData.label;
                                labelEl.title = labelData.label;
                            }
                            card.dataset.name = `${pkg} ${labelData.label}`.toLowerCase();
                        }
                    }
                },
                'backup': async () => {
                    adicionarLog(`[APPS] Iniciando backup de ${pkg}...`);
                    const res = await fetch('/dump_apk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device: dev, package: pkg })
                    });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Erro desconhecido');
                    
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    
                    const disposition = res.headers.get('Content-Disposition');
                    let filename = `${pkg}.apk`;
                    if (disposition?.includes('filename=')) {
                        filename = disposition.split('filename=')[1].replace(/['"]/g, '');
                    } else if (blob.type === 'application/zip') {
                        filename = `${pkg}_split.zip`;
                    }
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                    adicionarLog(`[APPS] Backup salvo: ${filename}`, 'success');
                },
                'view_manifest': async () => {
                    adicionarLog(`[APPS] Baixando Manifest de ${pkg} para visualização...`);
                    const res = await fetch('/extract_manifest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device: dev, package: pkg })
                    });
                    if (!res.ok) throw new Error((await res.json()).detail || 'Erro desconhecido');
                    
                    const text = await res.text();
                    const modal = document.getElementById('manifest-modal');
                    const codeBlock = document.getElementById('manifest-code');
                    
                    if (modal && codeBlock) {
                        modal.dataset.device = dev;
                        modal.dataset.package = pkg;
                        codeBlock.textContent = text;
                        if (window.hljs) hljs.highlightElement(codeBlock);
                        
                        window.manifestOriginalHTML = codeBlock.innerHTML;
                        const searchInput = document.getElementById('manifest-search');
                        if(searchInput) {
                            searchInput.value = '';
                            document.getElementById('manifest-search-count')?.classList.add('hidden');
                        }
                        modal.classList.remove('hidden');
                        modal.classList.add('flex');
                        adicionarLog(`[APPS] Manifest carregado.`, 'success');
                    }
                },
                'decompile': async () => {
                    adicionarLog(`[JADX] Iniciando descompilação de ${pkg}. Isso pode levar vários minutos...`, 'info');
                    try {
                        const res = await fetch('/decompile_apk', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ device: dev, package: pkg })
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.detail || 'Erro desconhecido');
                        adicionarLog(`[JADX] ${data.message}`, 'success');
                    } catch (err) {
                        adicionarLog(`[JADX] Erro: ${err.message}`, 'error');
                    }
                },
                'default': async () => {
                    const endpoints = {
                        'launch': '/app_action/launch',
                        'clear': '/app_action/clear',
                        'uninstall': '/app_action/uninstall'
                    };
                    adicionarLog(`[APPS] Executando ${action} em ${pkg}...`);
                    const res = await fetch(endpoints[action], {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device: dev, package: pkg })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || 'Erro desconhecido');
                    adicionarLog(`[APPS] ${data.message}`, 'success');
                    if (action === 'uninstall') loadAppsGrid();
                }
            };

            try {
                await (actionHandlers[action] || actionHandlers['default'])();
            } catch (err) {
                adicionarLog(`[APPS] Erro na ação '${action}': ${err.message}`, 'error');
            }
        });
    });
}

function setupRunWithScriptModal() {
    const modal = document.getElementById('run-with-script-modal');
    const scriptList = document.getElementById('run-with-script-list');
    const closeBtn = document.getElementById('run-with-script-modal-close-btn');

    if (!modal || !scriptList || !closeBtn) return;

    const closeModal = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    closeBtn.addEventListener('click', closeModal);

    scriptList.addEventListener('click', (e) => {
        if (e.target && e.target.dataset.script) {
            const scriptName = e.target.dataset.script;
            const pkg = modal.dataset.package;
            const dev = modal.dataset.device;

            if (scriptName && pkg && dev) {
                wsSend({
                    type: "executar_comando",
                    dispositivo_id: dev,
                    pacote: pkg,
                    scripts: [scriptName],
                    forma: document.querySelector('input[name="forma"]:checked')?.value
                });
                adicionarLog(`[CMD] Iniciando Frida em ${pkg} com ${scriptName}...`);

                const consoleTabBtn = document.querySelector('button[data-tab="console-panel"]');
                if (consoleTabBtn && consoleTabBtn.dataset.active !== 'true') {
                    consoleTabBtn.click();
                }
                closeModal();
            }
        }
    });
}

function setupManifestModal() {
    const modal = document.getElementById('manifest-modal');
    if (!modal) return;

    modal.querySelector('#manifest-modal-close-btn')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });
    
    modal.querySelector('#copy-manifest-btn')?.addEventListener('click', () => {
        const code = modal.querySelector('#manifest-code').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const btn = modal.querySelector('#copy-manifest-btn');
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado';
            setTimeout(() => btn.innerHTML = original, 2000);
        });
    });

    const searchInput = modal.querySelector('#manifest-search');
    const codeBlock = modal.querySelector('#manifest-code');
    const countEl = modal.querySelector('#manifest-search-count');

    searchInput?.addEventListener('input', () => {
        if (!window.manifestOriginalHTML) return;
        codeBlock.innerHTML = window.manifestOriginalHTML;
        const term = searchInput.value;
        if (!term) {
            countEl.classList.add('hidden');
            return;
        }
        const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![^<]*>)`, 'gi');
        let matchCount = 0;
        codeBlock.innerHTML = window.manifestOriginalHTML.replace(regex, (match) => {
            matchCount++;
            return `<mark class="bg-yellow-500 text-black rounded-sm search-match" id="m-match-${matchCount-1}">${match}</mark>`;
        });
        countEl.textContent = matchCount > 0 ? `1/${matchCount}` : `0/0`;
        countEl.classList.remove('hidden');
        countEl.dataset.total = matchCount;
        countEl.dataset.current = 0;
        if (matchCount > 0) document.getElementById('m-match-0')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const navigateSearch = (dir) => {
        if (!countEl || countEl.classList.contains('hidden')) return;
        let total = parseInt(countEl.dataset.total || 0), current = parseInt(countEl.dataset.current || 0);
        if (total === 0) return;
        document.getElementById(`m-match-${current}`)?.classList.remove('ring-2', 'ring-red-500');
        current = (current + dir + total) % total;
        countEl.dataset.current = current;
        countEl.textContent = `${current + 1}/${total}`;
        const nextEl = document.getElementById(`m-match-${current}`);
        if (nextEl) {
            nextEl.classList.add('ring-2', 'ring-red-500');
            nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    modal.querySelector('#manifest-search-next')?.addEventListener('click', () => navigateSearch(1));
    modal.querySelector('#manifest-search-prev')?.addEventListener('click', () => navigateSearch(-1));
}

function setupAiModal() {
    const aiModal = document.getElementById('ai-analysis-modal');
    if (!aiModal) return;
    let aiAbortController = null;

    aiModal.querySelector('#ai-modal-close-btn')?.addEventListener('click', () => {
        aiAbortController?.abort();
        aiModal.classList.add('hidden');
        aiModal.classList.remove('flex');
    });

    document.getElementById('analyze-manifest-ai-btn')?.addEventListener('click', async () => {
        const manifestModal = document.getElementById('manifest-modal');
        const dev = manifestModal.dataset.device, pkg = manifestModal.dataset.package;
        if (!dev || !pkg) return alert("Erro: Dispositivo ou pacote não identificado.");

        const statusEl = aiModal.querySelector('#ai-modal-status'), resultsEl = aiModal.querySelector('#ai-modal-results');
        aiModal.classList.remove('hidden');
        aiModal.classList.add('flex');
        statusEl.classList.remove('hidden');
        resultsEl.classList.add('hidden');
        
        aiAbortController?.abort();
        aiAbortController = new AbortController();

        statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-4xl text-brand mb-4"></i><br>O Agente Red Team está analisando o manifesto...<div class="mt-4"><button id="ai-cancel-analysis-btn" class="btn-danger text-xs px-4 py-2 rounded-full"><i class="fa-solid fa-stop"></i> Cancelar</button></div>`;
        aiModal.querySelector('#ai-cancel-analysis-btn').onclick = () => aiAbortController.abort();

        try {
            const res = await fetch('/analyze_manifest_with_ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device: dev, package: pkg }),
                signal: aiAbortController.signal
            });
            if (!res.ok) throw new Error((await res.json()).detail || "Erro na análise");
            
            const data = await res.json();
            aiModal.querySelector('#ai-res-summary').textContent = data.resumo_funcionalidade || "Sem resumo.";
            aiModal.querySelector('#ai-res-security').innerHTML = (data.analise_seguranca || "Sem vulnerabilidades.").replace(/\n/g, '<br>');
            aiModal.querySelector('#ai-res-exploit').textContent = data.vetor_exploracao_sugerido || "N/A";
            aiModal.querySelector('#ai-res-frida-script').textContent = data.sugestao_script_frida || "// Nenhum script sugerido";
            
            statusEl.classList.add('hidden');
            resultsEl.classList.remove('hidden');
        } catch (e) {
            if (e.name !== 'AbortError') statusEl.innerHTML = `<span class="text-red-400"><i class="fa-solid fa-triangle-exclamation"></i> Erro: ${e.message}</span>`;
            else statusEl.innerHTML = `<span class="text-yellow-400"><i class="fa-solid fa-ban"></i> Análise cancelada.</span>`;
        } finally {
            aiAbortController = null;
        }
    });
}

function setupTerminal() {
    const input = document.getElementById('terminal-input');
    const output = document.getElementById('terminal-output');
    if (!input || !output) return;

    const commandHistory = [];
    let historyIndex = -1;

    const appendToTerminal = (text, type = 'output') => {
        const line = document.createElement('div');
        if (type === 'input') {
            line.innerHTML = `<span class="text-brand">$ adb</span> <span class="text-txt">${text}</span>`;
        } else if (type === 'error') {
            line.innerHTML = `<span class="text-red-400">${text}</span>`;
        } else {
            line.textContent = text;
        }
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    };

    const executeCommand = async (command) => {
        if (!command) return;
        appendToTerminal(command, 'input');
        try {
            const response = await fetch('/execute_adb_command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, device: getSelectedDevice() })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Erro desconhecido');
            appendToTerminal(data.output || 'Comando executado sem saída.');
        } catch (error) {
            appendToTerminal(`Erro: ${error.message}`, 'error');
        }
    };

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const command = input.value.trim();
            await executeCommand(command);
            if (command) {
                commandHistory.unshift(command);
                historyIndex = -1;
            }
            input.value = '';
        } else if (e.key === 'ArrowUp') {
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                input.value = commandHistory[historyIndex];
            }
        } else if (e.key === 'ArrowDown') {
            if (historyIndex > 0) {
                historyIndex--;
                input.value = commandHistory[historyIndex];
            } else {
                historyIndex = -1;
                input.value = '';
            }
        }
    });

    document.querySelectorAll('.terminal-quick-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            const command = btn.dataset.command;
            const needsConfirm = btn.dataset.requiresConfirmation === 'true';
            const confirmMsg = btn.dataset.confirmMessage;

            if (needsConfirm && !confirm(confirmMsg)) {
                return;
            }
            await executeCommand(command);
        });
    });
}

function setupGallery() {
    const refreshBtn = document.getElementById('refresh-gallery-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadGallery);
    }
}

async function loadGallery() {
    const container = document.getElementById('gallery-container');
    if (!container) return;

    container.innerHTML = '<div class="text-center text-muted mt-10"><i class="fa-solid fa-spinner fa-spin"></i> Carregando galeria...</div>';

    try {
        const response = await fetch('/gallery/list');
        const data = await response.json();
        
        container.innerHTML = '';

        const deviceIds = Object.keys(data);
        if (deviceIds.length === 0) {
            container.innerHTML = '<div class="text-center text-muted mt-10">Nenhuma mídia encontrada.</div>';
            return;
        }

        deviceIds.forEach(deviceId => {
            const deviceSection = document.createElement('div');
            deviceSection.className = 'mb-8';
            
            const deviceName = document.querySelector(`#dispositivos option[value="${deviceId.replace(/_/g, ':')}"]`)?.textContent || deviceId;

            deviceSection.innerHTML = `
                <h4 class="font-bold text-txt mb-3 flex items-center gap-2 text-sm uppercase tracking-wider border-b border-border-color pb-2">
                    <i class="fa-solid fa-mobile-screen-button"></i> ${deviceName}
                </h4>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 media-grid"></div>
            `;
            
            const mediaGrid = deviceSection.querySelector('.media-grid');
            data[deviceId].forEach(media => {
                const card = createMediaCard(media);
                mediaGrid.appendChild(card);
            });

            container.appendChild(deviceSection);
        });

    } catch (error) {
        container.innerHTML = `<div class="text-center text-red-400 mt-10">Erro ao carregar galeria: ${error.message}</div>`;
    }
}

function createMediaCard(media) {
    const card = document.createElement('div');
    card.className = 'relative group bg-panel border border-border-color rounded-lg overflow-hidden aspect-video flex items-center justify-center';

    const date = new Date(media.timestamp * 1000);
    const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

    const mediaElement = media.type === 'video' 
        ? `<video src="/gallery/media/${media.filename}" class="w-full h-full object-cover" controls></video>`
        : `<img src="/gallery/media/${media.filename}" class="w-full h-full object-cover" loading="lazy">`;

    card.innerHTML = `
        ${mediaElement}
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
            <div class="text-xs text-muted font-mono">${formattedDate}</div>
            <div class="absolute top-2 right-2 flex gap-2">
                <a href="/gallery/media/${media.filename}" download="${media.filename}" class="btn-ghost w-8 h-8 p-0" title="Download">
                    <i class="fa-solid fa-download"></i>
                </a>
                <button class="btn-ghost w-8 h-8 p-0 hover:text-red-400 delete-media-btn" data-filename="${media.filename}" title="Excluir">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;

    card.querySelector('.delete-media-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const filename = e.currentTarget.dataset.filename;
        if (confirm(`Tem certeza que deseja excluir "${filename}"?`)) {
            try {
                const response = await fetch('/gallery/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: filename })
                });
                if (!response.ok) throw new Error('Falha ao excluir');
                card.remove();
                adicionarLog(`[GALERIA] Arquivo ${filename} excluído.`, 'success');
            } catch (err) {
                adicionarLog(`[ERRO GALERIA] ${err.message}`, 'error');
            }
        }
    });

    return card;
}


document.getElementById("dumpApkBtn")?.addEventListener("click", async () => {
    const dev = getSelectedDevice();
    const pkg = getSelectedPackage();
    if (!dev || !pkg) {
        adicionarLog("[ERRO] Dispositivo ou pacote não selecionado.", "error");
        return;
    }

    adicionarLog(`[INFO] Extraindo APK para ${pkg}...`);
    try {
        const response = await fetch("/dump_apk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device: dev, package: pkg }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "Falha ao extrair APK.");
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${pkg}.apk`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        adicionarLog(`[SUCCESS] APK ${pkg}.apk extraído com sucesso.`);
    } catch (e) {
        adicionarLog(`[ERRO] ${e.message}`, "error");
    }
});

function setupScriptEditor() {
    const editorContainer = document.getElementById('editor-container');
    if (!editorContainer) return;

    // Força estilos no container para garantir que o CodeMirror exiba a barra de rolagem
    editorContainer.style.height = "100%";
    editorContainer.style.position = "relative";
    editorContainer.style.overflow = "hidden";

    editor = CodeMirror(editorContainer, {
        value: "// Selecione um script ou crie um novo.",
        mode: "javascript",
        theme: "material-darker",
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });

    editor.setSize("100%", "100%");

    const scriptListEl = document.getElementById('editor-script-list');
    const currentFileEl = document.getElementById('editor-current-file');
    const saveBtn = document.getElementById('editor-save-btn');
    const deleteBtn = document.getElementById('editor-delete-btn');
    const runBtn = document.getElementById('editor-run-btn');
    const newBtn = document.getElementById('editor-new-btn');
    const refreshBtn = document.getElementById('editor-refresh-btn');
    const aiBtn = document.getElementById('editor-ai-btn');

    async function loadScriptList() {
        try {
            const res = await fetch('/listar_scripts');
            const scripts = await res.json();
            scriptListEl.innerHTML = '';
            scripts.forEach(s => {
                const item = document.createElement('div');
                item.className = 'font-mono text-sm p-2 rounded cursor-pointer hover:bg-white/10';
                item.textContent = s;
                item.addEventListener('click', () => loadScriptContent(s));
                scriptListEl.appendChild(item);
            });
        } catch (e) {
            adicionarLog(`Erro ao listar scripts: ${e.message}`, 'error');
        }
    }

    async function loadScriptContent(filename) {
        try {
            const res = await fetch(`/script/${filename}`);
            if (!res.ok) throw new Error(await res.text());
            const content = await res.text();
            editor.setValue(content);
            currentFileEl.textContent = filename;
            editor.setOption("readOnly", false);
            saveBtn.disabled = false;
            deleteBtn.disabled = false;
            runBtn.disabled = false;
            aiBtn.disabled = false;
        } catch (e) {
            adicionarLog(`Erro ao carregar script '${filename}': ${e.message}`, 'error');
        }
    }

    newBtn.addEventListener('click', () => {
        const filename = prompt("Digite o nome do novo script (ex: bypass.js):");
        if (!filename) return;
        if (!filename.endsWith('.js')) {
            alert("O nome do arquivo deve terminar com .js");
            return;
        }
        editor.setValue(`// Novo script: ${filename}\n\nJava.perform(function() {\n    console.log("Script carregado!");\n});`);
        currentFileEl.textContent = filename;
        editor.setOption("readOnly", false);
        saveBtn.disabled = false;
        deleteBtn.disabled = true; // Não pode deletar antes de salvar
        runBtn.disabled = false;
        aiBtn.disabled = false;
        loadScriptList(); // Atualiza a lista para o caso de o usuário salvar
    });

    saveBtn.addEventListener('click', async () => {
        const filename = currentFileEl.textContent;
        const content = editor.getValue();
        if (!filename || filename === "Nenhum arquivo selecionado") return;

        try {
            const res = await fetch('/script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, content })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail);
            adicionarLog(`[EDITOR] ${data.message}`, 'success');
            deleteBtn.disabled = false;
            loadScriptList();
        } catch (e) {
            adicionarLog(`[EDITOR] Erro ao salvar: ${e.message}`, 'error');
        }
    });

    deleteBtn.addEventListener('click', async () => {
        const filename = currentFileEl.textContent;
        if (!filename || filename === "Nenhum arquivo selecionado") return;
        if (!confirm(`Tem certeza que deseja deletar o script "${filename}"?`)) return;

        try {
            const res = await fetch(`/script/${filename}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail);
            adicionarLog(`[EDITOR] ${data.message}`, 'success');
            editor.setValue("// Selecione um script ou crie um novo.");
            currentFileEl.textContent = "Nenhum arquivo selecionado";
            editor.setOption("readOnly", true);
            saveBtn.disabled = true;
            deleteBtn.disabled = true;
            runBtn.disabled = true;
            aiBtn.disabled = true;
            loadScriptList();
        } catch (e) {
            adicionarLog(`[EDITOR] Erro ao deletar: ${e.message}`, 'error');
        }
    });

    runBtn.addEventListener('click', () => {
        const content = editor.getValue();
        const device = getSelectedDevice();
        const pkg = getSelectedPackage();

        if (!device || !pkg) {
            adicionarLog("[ERRO] Selecione um dispositivo e um pacote para executar o script.", "error");
            return;
        }
        if (!content) {
            adicionarLog("[ERRO] O editor está vazio. Não há nada para executar.", "error");
            return;
        }

        wsSend({
            type: "executar_script_conteudo",
            dispositivo_id: device,
            pacote: pkg,
            conteudo: content,
            forma: document.querySelector('input[name="forma"]:checked')?.value
        });
        adicionarLog(`[CMD] Iniciando script do editor em ${pkg}...`);
        // Mudar para a aba do console para ver a saída
        document.querySelector('button[data-tab="console-panel"]')?.click();
    });

    aiBtn.addEventListener('click', async () => {
        const objective = prompt("Qual o objetivo deste script? (ex: 'hookar a função de login', 'bypassar SSL pinning')");
        if (!objective) return;

        const content = editor.getValue();
        const pkg = getSelectedPackage();
        
        aiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pensando...';
        aiBtn.disabled = true;

        try {
            const res = await fetch('/improve_script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, objective, package: pkg })
            });
            if (!res.ok) throw new Error((await res.json()).detail || "Erro da API");
            
            const newContent = await res.text();
            editor.setValue(newContent);
            adicionarLog("[EDITOR] Script melhorado pela IA!", "success");
        } catch (e) {
            adicionarLog(`[EDITOR] Erro da IA: ${e.message}`, "error");
        } finally {
            aiBtn.innerHTML = '<i class="fa-solid fa-robot text-brand"></i> Melhorar com IA';
            aiBtn.disabled = false;
        }
    });

    refreshBtn.addEventListener('click', loadScriptList);

    // Carregar lista inicial
    loadScriptList();
}

function setupJadxUI() {
    const container = document.getElementById('jadx-editor-container');
    if (!container) return;

    // Força estilos no container para garantir que o CodeMirror exiba a barra de rolagem
    container.style.height = "100%";
    container.style.position = "relative";
    container.style.overflow = "hidden";

    // Inicializa CodeMirror para JADX (Read Only)
    jadxEditor = CodeMirror(container, {
        value: "// Selecione um arquivo na árvore lateral para visualizar.",
        mode: "text/x-java", // Default, muda dinamicamente
        theme: "material-darker",
        lineNumbers: true,
        readOnly: true,
        lineWrapping: true
    });
    jadxEditor.setSize("100%", "100%");

    const projectSelect = document.getElementById('jadx-project-select');
    const refreshBtn = document.getElementById('jadx-refresh-projects');
    const uploadBtn = document.getElementById('jadx-upload-btn');
    const searchInput = document.getElementById('jadx-file-search');
    const treeContainer = document.getElementById('jadx-file-tree');
    const pathLabel = document.getElementById('jadx-current-path');

    let currentFiles = [];

    window.loadJadxProjects = async () => {
        try {
            const res = await fetch('/jadx/projects');
            const projects = await res.json();
            const currentVal = projectSelect.value;
            
            projectSelect.innerHTML = '<option value="">Selecione um projeto...</option>';
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                projectSelect.appendChild(opt);
            });
            if (projects.includes(currentVal)) projectSelect.value = currentVal;
        } catch (e) {
            adicionarLog(`[JADX] Erro ao listar projetos: ${e.message}`, 'error');
        }
    };

    refreshBtn?.addEventListener('click', loadJadxProjects);

    if (uploadBtn) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.apk';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        uploadBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            const originalHtml = uploadBtn.innerHTML;
            uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            uploadBtn.disabled = true;
            adicionarLog(`[JADX] Enviando e descompilando ${file.name}...`, 'info');

            try {
                const res = await fetch('/decompile_local_apk', { method: 'POST', body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Erro desconhecido');
                
                adicionarLog(`[JADX] Sucesso! Projeto: ${data.package}`, 'success');
                await loadJadxProjects();
                projectSelect.value = data.package;
                projectSelect.dispatchEvent(new Event('change'));
            } catch (err) {
                adicionarLog(`[JADX] Erro: ${err.message}`, 'error');
            } finally {
                uploadBtn.innerHTML = originalHtml;
                uploadBtn.disabled = false;
                fileInput.value = '';
            }
        });
    }

    projectSelect?.addEventListener('change', async () => {
        const pkg = projectSelect.value;
        if (!pkg) {
            treeContainer.innerHTML = '<div class="text-center mt-4 opacity-50">Selecione um projeto</div>';
            searchInput.disabled = true;
            return;
        }

        treeContainer.innerHTML = '<div class="text-center mt-4"><i class="fa-solid fa-spinner fa-spin"></i> Carregando estrutura...</div>';
        searchInput.disabled = true;

        try {
            const res = await fetch('/jadx/structure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package: pkg })
            });
            if (!res.ok) throw new Error((await res.json()).detail);
            
            currentFiles = await res.json();
            renderFileTree(currentFiles);
            searchInput.disabled = false;
            adicionarLog(`[JADX] Projeto ${pkg} carregado. ${currentFiles.length} arquivos.`);
        } catch (e) {
            treeContainer.innerHTML = `<div class="text-red-400 p-2 text-xs">Erro: ${e.message}</div>`;
        }
    });

    searchInput?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if (!term) {
            // Se limpar a busca, renderiza a árvore completa
            renderFileTree(currentFiles, false);
        } else {
            // Se tiver busca, renderiza lista plana (igual VS Code)
            const filtered = currentFiles.filter(f => f.path.toLowerCase().includes(term));
            renderFileTree(filtered, true);
        }
    });

    function renderFileTree(files, isFlatSearch = false) {
        treeContainer.innerHTML = '';
        
        if (isFlatSearch) {
            // Renderização Plana (Modo Busca)
            const limit = 500;
            const list = files.slice(0, limit);
            
            list.forEach(f => {
                const div = document.createElement('div');
                div.className = 'cursor-pointer hover:bg-white/10 hover:text-white truncate px-1 py-0.5 rounded flex items-center gap-2';
                div.title = f.path;
                div.innerHTML = `<i class="fa-solid ${getFileIcon(f.ext)} text-[10px]"></i> ${f.path}`;
                div.onclick = () => {
                    document.querySelectorAll('.tree-content.selected').forEach(el => el.classList.remove('selected'));
                    div.classList.add('bg-brand/20', 'text-brand');
                    loadFileContent(f.path);
                };
                treeContainer.appendChild(div);
            });
            if (files.length > limit) {
                const more = document.createElement('div');
                more.className = 'text-center text-muted italic p-2';
                more.textContent = `...mais ${files.length - limit} resultados`;
                treeContainer.appendChild(more);
            }
        } else {
            // Renderização Hierárquica (Árvore)
            const tree = buildTreeStructure(files);
            treeContainer.appendChild(createTreeDOM(tree));
        }
    }

    // Converte lista plana em objeto aninhado
    function buildTreeStructure(files) {
        const root = {};
        files.forEach(file => {
            const parts = file.path.split('/');
            let current = root;
            parts.forEach((part, i) => {
                if (!current[part]) {
                    current[part] = {
                        name: part,
                        children: {},
                        isFile: (i === parts.length - 1), // Última parte é o arquivo
                        path: file.path,
                        ext: file.ext
                    };
                }
                current = current[part].children;
            });
        });
        return root;
    }

    // Cria o DOM recursivamente
    function createTreeDOM(nodeObj) {
        const ul = document.createElement('div');
        ul.className = 'tree-level';

        // Ordena: Pastas primeiro, depois arquivos
        const keys = Object.keys(nodeObj).sort((a, b) => {
            const nodeA = nodeObj[a], nodeB = nodeObj[b];
            if (nodeA.isFile !== nodeB.isFile) return nodeA.isFile ? 1 : -1;
            return a.localeCompare(b);
        });

        keys.forEach(key => {
            const node = nodeObj[key];
            const item = document.createElement('div');
            item.className = 'tree-node';
            
            if (node.isFile) {
                // É Arquivo
                item.innerHTML = `
                    <div class="tree-content" title="${node.path}">
                        <i class="fa-solid ${getFileIcon(node.ext)} tree-icon"></i>
                        <span>${node.name}</span>
                    </div>`;
                item.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.tree-content.selected').forEach(el => el.classList.remove('selected'));
                    item.querySelector('.tree-content').classList.add('selected');
                    loadFileContent(node.path);
                };
            } else {
                // É Pasta
                item.classList.add('folder-closed');
                const content = document.createElement('div');
                content.className = 'tree-content';
                content.innerHTML = `<i class="fa-solid fa-folder tree-icon"></i> <span>${node.name}</span>`;
                
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                
                // Lazy render dos filhos (opcional, mas aqui renderizamos tudo e ocultamos via CSS)
                childrenContainer.appendChild(createTreeDOM(node.children));

                content.onclick = (e) => {
                    e.stopPropagation();
                    const isExpanded = childrenContainer.classList.contains('expanded');
                    if (isExpanded) {
                        childrenContainer.classList.remove('expanded');
                        item.classList.remove('folder-open');
                        item.classList.add('folder-closed');
                        content.querySelector('i').className = 'fa-solid fa-folder tree-icon';
                    } else {
                        childrenContainer.classList.add('expanded');
                        item.classList.remove('folder-closed');
                        item.classList.add('folder-open');
                        content.querySelector('i').className = 'fa-solid fa-folder-open tree-icon';
                    }
                };

                item.appendChild(content);
                item.appendChild(childrenContainer);
            }
            ul.appendChild(item);
        });
        return ul;
    }

    function getFileIcon(ext) {
        if (ext === '.java') return 'fa-copyright text-orange-400'; // C de Class/Java
        if (ext === '.xml') return 'fa-code text-green-400';
        if (ext === '.png' || ext === '.jpg' || ext === '.webp') return 'fa-image text-purple-400';
        if (ext === '.json') return 'fa-file-code text-yellow-400';
        if (ext === '.so') return 'fa-puzzle-piece text-gray-400';
        return 'fa-file text-gray-500';
    }

    async function loadFileContent(path) {
        const pkg = projectSelect.value;
        pathLabel.textContent = path;
        jadxEditor.setValue("Carregando...");
        
        try {
            const res = await fetch('/jadx/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package: pkg, file_path: path })
            });
            if (!res.ok) throw new Error((await res.json()).detail);
            
            const data = await res.json();
            
            // Detecta modo
            let mode = "javascript"; // fallback
            if (path.endsWith('.java')) mode = "text/x-java";
            else if (path.endsWith('.xml')) mode = "xml";
            else if (path.endsWith('.json')) mode = "application/json";
            
            jadxEditor.setOption("mode", mode);
            jadxEditor.setValue(data.content);
        } catch (e) {
            jadxEditor.setValue(`Erro ao ler arquivo: ${e.message}`);
        }
    }
}

function setupLayoutToggles() {
    const mainGrid = document.getElementById('main-grid');
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    const btnLeft = document.getElementById('toggleLeftSidebarBtn');
    const btnRight = document.getElementById('toggleRightSidebarBtn');

    function updateGrid() {
        // Apenas aplica lógica de colunas em telas grandes (desktop)
        if (window.innerWidth >= 1024) {
            const leftHidden = leftSidebar.classList.contains('hidden');
            const rightHidden = rightSidebar.classList.contains('hidden');
            
            let cols = [];
            if (!leftHidden) cols.push('320px');
            cols.push('1fr');
            if (!rightHidden) cols.push('360px');
            
            mainGrid.style.gridTemplateColumns = cols.join(' ');
        } else {
            mainGrid.style.gridTemplateColumns = ''; // Reseta para o CSS padrão (mobile)
        }
        // Atualiza o editor se estiver visível, pois o tamanho do container mudou
        if (editor) setTimeout(() => editor.refresh(), 300);
        if (jadxEditor) setTimeout(() => jadxEditor.refresh(), 300);
    }

    btnLeft?.addEventListener('click', () => {
        leftSidebar.classList.toggle('hidden');
        updateGrid();
    });

    btnRight?.addEventListener('click', () => {
        rightSidebar.classList.toggle('hidden');
        updateGrid();
    });

    window.addEventListener('resize', updateGrid);
}
