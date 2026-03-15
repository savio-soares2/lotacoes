@echo off
setlocal

REM Vai para a pasta onde o BAT esta
pushd "%~dp0"

REM Inicia backend (porta 8000)
start "Backend - Lotacoes" cmd /k "call "%~dp0start_backend.bat""

REM Inicia frontend (porta 5173)
start "Frontend - Lotacoes" cmd /k "call "%~dp0start_frontend.bat""

echo Frontend e backend iniciados em janelas separadas.
echo Backend: http://127.0.0.1:8000
echo Frontend: http://localhost:5173

popd
endlocal
