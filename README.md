# Sistema de Automacao de Lotacoes

Projeto com frontend em React e backend em Node.js (Express) para formulario de solicitacao, controle de acesso por perfil e relatorios.

## Perfis de acesso

- `admin`: acesso total, incluindo importar planilhas e limpar entradas.
- `gestao`: visualizar dados, usar filtros e exportar relatorios.
- sem login: pode apenas preencher e enviar o formulario de solicitacao.

Usuarios iniciais:

- `admin` / `admin123`
- `gestao` / `gestao123`

## Regras aplicadas

1. Tempo de servico (data de admissao mais antiga)
2. Idade (data de nascimento mais antiga)
3. Distancia residencia-unidade (nao automatizado; os casos empatados nos 2 primeiros criterios vao para lista manual)

## Fluxo implementado

- O usuario informa CPF e matricula.
- O sistema preenche automaticamente os demais dados do servidor a partir das tabelas de referencia locais.
- As unidades e vagas sao cruzadas por cargo com o quadro de vagas.
- O formulario aceita ate 3 opcoes de unidade sem repeticao.
- Somente perfis autenticados conseguem visualizar entradas, aplicar filtros e gerar relatorios CSV.

## Estrutura

- `backend`: API Express com autenticacao, perfis e persistencia SQLite
- `frontend`: formulario publico + painel autenticado (admin/gestao)

## Tabelas de referencia locais

- `UPAS POR CARGO - 13-03-2026.xlsx` (aba `NOMINAL` para cadastro de servidores)
- `Quadro de Vagas Edital.xlsx` (abas com distribuicao de vagas por unidade/cargo)

A carga e feita automaticamente no start do backend e pode ser recarregada pelo admin.

## Como executar

### 0) Configurar ambiente (.env)

Backend:

```powershell
cd backend
copy .env.example .env
```

Frontend:

```powershell
cd frontend
copy .env.example .env
```

Variaveis principais:

- Backend: `PORT`, `JWT_SECRET`, `CORS_ORIGINS`, `FRONTEND_DIST`, `REF_SERVERS_FILE`, `REF_VAGAS_FILE`, `REF_VAGAS_SHEET`, `REF_VAGAS_HEADER_ROW`, `REF_VAGAS_DATA_START_ROW`, `REF_VAGAS_DATA_END_ROW`
- Frontend: `VITE_API_BASE`

### 1) Backend

```powershell
cd backend
npm install
npm run dev
```

### 2) Frontend

```powershell
cd frontend
npm install
npm run dev
```

Acesse: http://localhost:5173

## Deploy unificado (uma aplicacao)

Para deploy simplificado, o backend pode servir o frontend buildado no mesmo processo.

1. Gerar build do frontend:

```powershell
cd frontend
npm install
npm run build
```

2. Subir apenas o backend:

```powershell
cd backend
npm install
npm start
```

3. O backend servira:

- API em `/api/*`
- Frontend (SPA) nas demais rotas

Observacao: para deploy unificado, deixe `VITE_API_BASE` vazio no frontend (ou nao defina), assim o app usa a mesma origem (`/api`).

Se a plataforma nao permitir definir build command (apenas gerenciador de pacotes), o projeto ja esta preparado:

- `backend/package.json` executa `postinstall`
- o `postinstall` e o `prestart` executam `backend/scripts/ensure-frontend-build.mjs`
- esse script garante que `frontend/dist/index.html` exista antes de subir a API

Ou seja, no deploy com diretorio raiz em `backend`, o frontend sera buildado automaticamente durante o `npm install`.

## API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/admin/reload-reference` (admin)
- `GET /api/form/lookup?cpf=...&matricula=...` (publico)
- `POST /api/form/submit` (publico)
- `GET /api/requests` (admin/gestao)
- `GET /api/reports/requests.csv` (admin/gestao)
- `DELETE /api/requests` (admin)

## Saidas

- Entradas de solicitacao com filtros por cargo/unidade/busca
- Exportacao CSV das entradas
- Metricas de base importada (servidores, vagas, solicitacoes)
