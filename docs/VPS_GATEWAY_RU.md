# Частный VPS-шлюз PC Agent (только чтение)

Это защищённый исходящий SSH-канал Windows → VPS. Он позволяет
MCP-клиенту на VPS обращаться к пяти read-only инструментам локального
Windows PC Agent. Шлюз НЕ предоставляет произвольное исполнение команд,
не управляет мышью и не публикует исходный Desktop Agent в интернете.

## Архитектура


```text
MCP stdio client (VPS)
  -> tools/vps_gateway_stdio.mjs (token from private file)
  -> VPS 127.0.0.1:17423
  -> SSH reverse forwarding (encrypted, -R)
  -> Windows 127.0.0.1:17423
  -> readonly_gateway_server.mjs (AUTH and max 2 clients)
  -> web_safe.mjs (allowlisted tools)
  -> local Desktop Agent 127.0.0.1:17322 (desktop.token STAYS on PC)
```


В обоих местах порт привязан только к 127.0.0.1. На VPS копируется
отдельный случайный gateway.token, доступный только SSH-пользователю;
основной desktop.token никогда не покидает ПК. Администратор VPS
потенциально может читать данные окон — используйте доверенный сервер.

## Подготовка

Windows 10/11, Node.js 18+, установленный harness и PuTTY plink.
VPS: Linux, Node.js 18+, SSH (проверенный host-key, авторизация ключом).
SSH-соединение инициируется с Windows; входящие порты на ПК не открываются.

Обновление локальной копии репозитория и runtime:


```powershell
git pull --ff-only origin main
# Полное обновление (может затронуть основные службы):
.\scripts\install.ps1 -Repository <owner/repository> -UpdateChannel main

# Без остановки текущего RDC: скопировать только шлюзовые MCP-модули:
Copy-Item .\src\desktop_agent\mcp\web_safe.mjs "$env:LOCALAPPDATA\RdcWorkstationHarness\desktop-agent\mcp\" -Force
Copy-Item .\src\desktop_agent\mcp\readonly_gateway_server.mjs "$env:LOCALAPPDATA\RdcWorkstationHarness\desktop-agent\mcp\" -Force
```


Запуск, проверка и остановка (параметры VPS и отпечаток SSH
задаются только локально, не в git):


```powershell
.\scripts\vps-gateway.ps1 -Action start -VpsHost <YOUR_VPS_HOST> -VpsUser <SSH_USER> -SshPort <SSH_PORT> -HostKey '<PINNED_HOST_KEY>'
.\scripts\vps-gateway.ps1 -Action status
.\scripts\vps-gateway.ps1 -Action test -VpsHost <YOUR_VPS_HOST> -VpsUser <SSH_USER> -SshPort <SSH_PORT> -HostKey '<PINNED_HOST_KEY>'
.\scripts\vps-gateway.ps1 -Action stop
```


Команда start в фоновом режиме запускает локальный сервер и plink -R,
передаёт на VPS через SSH три файла (gateway.token, stdio.mjs, smoke.mjs),
а затем выполняет end-to-end smoke-тест MCP initialize, tools/list и
pc_health. Изолированный сервер не перезапускает RDC или PC Agent.
Пока запуск требует интерактивного пользователя Windows и Pageant:
автозапуск после перезагрузки ещё не настроен.

На VPS можно вручную проверить канал или запустить локальный stdio MCP:


```bash
node ~/.config/rdc-workstation-harness/smoke.mjs
node ~/.config/rdc-workstation-harness/stdio.mjs
```


## Разрешения и диагностика

Разрешённые MCP tools: pc_health, pc_windows, pc_active_window,
pc_uia_tree, pc_look_window. Нет desktop_action, exec, свободного
доступа к файлам, clipboard, браузерным credentials и физического ввода.

- Неверный AUTH приводит к закрытию соединения до запуска MCP.
- Порт 17423 должен слушать ТОЛЬКО 127.0.0.1 на обеих машинах.
- Windows logs: %LOCALAPPDATA%\RdcWorkstationHarness\gateway\
  server.stderr.log и plink.stderr.log (без секретов).
- После перезагрузки или потери SSH можно запустить start повторно.
- При компрометации VPS отзовите/замените gateway.token и остановите шлюз.

## Независимость от OpenAI

Этот шлюз подтверждает приватную связь VPS ↔ Windows и read-only MCP.
Он НЕ включает OpenAI Secure MCP Tunnel, не передаёт OpenAI API key
на VPS и не снимает ограничений доступа OpenAI по регионам.
Если OpenAI Control Plane отвечает
403 unsupported_country_region_territory, необходима отдельная
проверка/разрешение со стороны OpenAI. Перенаправлять трафик для
обхода ограничений нельзя.