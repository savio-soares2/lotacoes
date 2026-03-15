@echo off
setlocal

pushd "%~dp0backend"

echo [INFO] Pasta backend: %CD%

echo [INFO] Verificando porta 8000...
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Write-Host ('[INFO] Encerrando processo na porta 8000 (PID ' + $conn.OwningProcess + ')...'); Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [INFO] Instalando dependencias do backend Node...
call npm install
if errorlevel 1 (
  echo [ERRO] Falha ao instalar dependencias.
  goto :end
)

echo [INFO] Iniciando API em http://127.0.0.1:8000
call npm run dev

:end
popd
endlocal
