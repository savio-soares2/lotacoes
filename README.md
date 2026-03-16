# Sistema de Automacao de Lotacoes

Projeto com frontend em React e backend em Node.js (Express) para formulario de solicitacao, controle de acesso por perfil e relatorios.

## Perfis de acesso

- `admin`: acesso total, incluindo importar planilhas e limpar entradas.
- `gestao`: visualizar dados, usar filtros e exportar relatorios.
- sem login: pode apenas preencher e enviar o formulario de solicitacao.

Usuarios iniciais:

- Definidos por variaveis de ambiente no primeiro bootstrap do banco (`ADMIN_BOOTSTRAP_*` e opcionalmente `GESTAO_BOOTSTRAP_*`).

## Regras aplicadas

1. Tempo de servico (data de admissao mais antiga)
2. Idade (data de nascimento mais antiga)
3. Distancia residencia-unidade (nao automatizado; os casos empatados nos 2 primeiros criterios vao para lista manual)

## Fluxo implementado

- O usuario informa CPF e matricula.
- O sistema preenche automaticamente os demais dados do servidor a partir das tabelas de referencia locais.
- As unidades e vagas sao cruzadas por cargo com o quadro de vagas.
- O formulario aceita ate 3 opcoes de unidade sem repeticao.
- Somente perfis autenticados conseguem visualizar entradas, aplicar filtros e gerar relatorios CSV e Word (.docx).

## Estrutura

- `backend`: API Express com autenticacao, perfis e persistencia SQLite
- `frontend`: formulario publico + painel autenticado (admin/gestao)

## Tabelas de referencia locais

- `backend/data/UPAS POR CARGO - 13-03-2026.xlsx` (aba `NOMINAL` para cadastro de servidores)
- `backend/data/Quadro de Vagas Edital.xlsx` (abas com distribuicao de vagas por unidade/cargo)

A carga e feita automaticamente no start do backend e pode ser recarregada pelo admin.

## Como executar

### Ambiente local (modo separado)

1) Backend

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

2) Frontend

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Acesse: http://localhost:5173

### Deploy unificado (uma aplicacao)

O backend serve API e frontend estatico no mesmo processo.

1) Gerar frontend estatico dentro do backend

```powershell
cd backend
npm install
npm run sync:public
```

2) Subir backend

```powershell
cd backend
npm start
```

### Deploy Railway (1 servico recomendado)

Arquivos de ambiente:

- backend local: `backend/.env.example`
- backend railway: `backend/.env.railway.example`

#### Servico unico: Backend + Frontend estatico

Recomendado no painel do servico backend:

- framework: Express
- branch: `main`
- diretorio raiz: `backend`
- arquivo de entrada: `src/server.js`
- node: 18.x

Variaveis de ambiente (API):

- `HOST=0.0.0.0`
- `FALLBACK_PORTS=3000,8080,5000`
- `JWT_SECRET=<segredo forte>`
- `CORS_ORIGINS=https://saude.palmas.online,https://www.saude.palmas.online`
- `FRONTEND_DIST=public`
- `DATA_DIR=/tmp/lotacoes-data`
- `UPLOAD_DIR=/tmp/lotacoes-data/uploads`
- `TRUST_PROXY=1`
- `ADMIN_BOOTSTRAP_USERNAME=<usuario_admin_inicial>`
- `ADMIN_BOOTSTRAP_PASSWORD=<senha_admin_inicial>`
- `GESTAO_BOOTSTRAP_USERNAME=<usuario_gestao_inicial_opcional>`
- `GESTAO_BOOTSTRAP_PASSWORD=<senha_gestao_inicial_opcional>`
- `REF_SERVERS_FILE=data/UPAS POR CARGO - 13-03-2026.xlsx`
- `REF_VAGAS_FILE=data/Quadro de Vagas Edital.xlsx`
- `REF_VAGAS_SHEET=Página1`
- `REF_VAGAS_HEADER_ROW=1`
- `REF_VAGAS_DATA_START_ROW=2`
- `REF_VAGAS_DATA_END_ROW=44`

Nao fixe `PORT` em ambiente gerenciado.

O servidor abre listeners em multiplas portas candidatas para compatibilidade com ambientes gerenciados.
O banco SQLite usa `DATA_DIR` quando definido; em host gerenciado, prefira `/tmp/lotacoes-data`.

Build/start sugeridos no servico:

- build command: `npm run build`
- start command: `npm start`

O `npm run build` do backend gera o build do Vite e sincroniza para `backend/public` automaticamente.

### Opcional: Railway com 2 servicos (split)

Se preferir separar, mantenha backend em `backend` e frontend em `frontend`, com:

- frontend `VITE_API_BASE=<url publica do backend>`
- backend `FRONTEND_DIST=`

### Diagnostico rapido de 503 (sem logs)

Se o provedor nao mostrar logs de runtime, use o entrypoint `src/probe.js` temporariamente.

- `/` deve responder `probe-ok`
- `/api/health` deve responder JSON com `mode: "probe"`

Se com `probe.js` continuar 503, o problema e configuracao da plataforma/domino e nao da aplicacao.

## API

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/admin/reload-reference` (admin)
- `GET /api/form/lookup?cpf=...&matricula=...` (publico)
- `POST /api/form/submit` (publico)
- `GET /api/requests` (admin/gestao)
- `GET /api/reports/requests.csv` (admin/gestao)
- `GET /api/reports/requests.docx` (admin/gestao)
- `DELETE /api/requests` (admin)

## Saidas

- Entradas de solicitacao com filtros por cargo/unidade/busca
- Exportacao CSV e Word (.docx) das entradas
- Metricas de base importada (servidores, vagas, solicitacoes)
