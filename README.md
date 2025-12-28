# OmniHook Fr1da

**OmniHook Fr1da** é uma interface web avançada e unificada para instrumentação dinâmica, análise de segurança e gerenciamento de dispositivos Android. A ferramenta combina o poder do **Frida**, **ADB** e ferramentas de análise estática em um painel moderno e responsivo.

## 🚀 O que ela faz?

Esta aplicação atua como um "canivete suíço" para pesquisadores de segurança, pentesters e desenvolvedores Android, permitindo interagir com dispositivos conectados, injetar scripts Frida, manipular arquivos e analisar aplicativos sem a necessidade de decorar dezenas de comandos de terminal.

## ✨ Principais Funcionalidades

### 📱 Gerenciamento de Dispositivos & Telemetria
*   **Detecção Automática:** Lista dispositivos conectados via USB e TCP/IP.
*   **Insights em Tempo Real:** Monitoramento de bateria, temperatura, uso de CPU, status de Root e presença do servidor Frida.
*   **Controle ADB:** Reiniciar servidor Frida, conectar via Wi-Fi (TCP/IP) e terminal ADB integrado no navegador.
![device_manager](https://github.com/user-attachments/assets/00e8cbe4-002f-4edd-a996-a2b6effed4f8)

### 💉 Instrumentação com Frida
*   **Injeção de Scripts:** Selecione e execute múltiplos scripts `.js` simultaneamente em processos alvo.
*   **Editor de Código Integrado:** Editor robusto (baseado em CodeMirror) com *syntax highlighting* para criar, editar e salvar scripts de hook diretamente na ferramenta.
*   **Assistência de IA:** Funcionalidade para melhorar ou gerar scripts de hook utilizando Inteligência Artificial.
![instr_frida](https://github.com/user-attachments/assets/91f214d3-322e-4d59-b39a-dd388b4346a4)

### 📂 Explorador de Arquivos
*   **Navegação Completa:** Navegue pelo sistema de arquivos do Android com interface visual.
*   **Operações de Arquivo:** Upload, Download, Renomear e Excluir arquivos.
*   **Permissões:** Visualização de permissões e metadados dos arquivos.
![exp_file](https://github.com/user-attachments/assets/9eebf6ab-29b3-4ebf-b2e9-f16168f72bff)


### 📦 Gestão e Análise de Aplicativos
*   **Listagem de Pacotes:** Filtros visuais para Apps de Usuário e Sistema.
*   **Ações Rápidas:** Abrir, Limpar Dados, Desinstalar e fazer Backup (Dump) do APK.
*   **Engenharia Reversa:**
    *   **JADX Integration:** Descompilação automática de APKs.
    *   **Manifest Viewer:** Visualizador do `AndroidManifest.xml` com busca e *highlight*.
    *   **Análise de IA:** Agente "Red Team" que analisa o Manifesto em busca de vulnerabilidades de segurança.
![manager_apps](https://github.com/user-attachments/assets/da6f5756-a0b1-47f0-9149-69ddc22d1b92)

### 🛠️ Ferramentas Auxiliares
*   **Proxy Manager:** Configure ou limpe o proxy global do dispositivo (HTTP/S) com um clique (ideal para Burp Suite/ZAP).
*   **Espelhamento de Tela:** Integração com **scrcpy** para visualizar e controlar a tela do dispositivo.
*   **Galeria de Mídia:** Gerenciamento de screenshots e gravações feitas pela ferramenta.
*   **Logcat em Tempo Real:** Visualização de logs do sistema filtrados na interface.
![other_funct](https://github.com/user-attachments/assets/e64aad0b-8064-4ccf-8005-1add275def47)

## 🛠️ Dependências do Sistema

Para que todas as funcionalidades operem corretamente, o ambiente onde o servidor (backend) roda deve possuir:

1.  **Python 3.8+**
2.  **ADB (Android Debug Bridge):** Deve estar no PATH do sistema.
3.  **Frida Tools:** (`pip install frida-tools`)
4.  **JADX:** Necessário para as funções de descompilação.
5.  **Scrcpy:** Necessário para o espelhamento de tela.

## 📦 Instalação e Uso

1.  Instale as dependências Python (exemplo baseado em uso comum):
    ```bash
    pip install -r requirements.txt
    ```

2.  Certifique-se de que o ADB reconhece seu dispositivo:
    ```bash
    adb devices
    ```

3.  Inicie a aplicação (comando genérico, verifique o arquivo principal do servidor, ex: `main.py` ou `app.py`):
    ```bash
    python main.py
    ```

4.  Acesse no navegador:
    ```
    http://localhost:8000
    ```

## 🎨 Personalização

A interface possui suporte a **Temas (Claro/Escuro)** automáticos ou manuais, garantindo conforto visual durante longas sessões de análise.

---

*Desenvolvido para facilitar a vida de quem analisa segurança mobile.*
