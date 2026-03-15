@echo off
setlocal

pushd "%~dp0frontend"

echo [INFO] Pasta frontend: %CD%
echo [INFO] Garantindo dependencias do frontend...
call npm install
if errorlevel 1 (
  echo [ERRO] Falha ao instalar dependencias do frontend.
  goto :end
)

echo [INFO] Iniciando Vite em http://localhost:5173
call npm run dev

:end
popd
endlocal
