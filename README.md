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

### Deploy Hostinger (separado em 2 apps)

Arquivos de ambiente:

- backend local: `backend/.env.example`
- backend hostinger api: `backend/.env.hostinger.example`
- frontend hostinger: `frontend/.env.hostinger.example`

#### App 1: API (`api.palmas.online`)

Recomendado no painel da API:

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
- `FRONTEND_DIST=`
- `DATA_DIR=/tmp/lotacoes-data`
- `REF_SERVERS_FILE=data/UPAS POR CARGO - 13-03-2026.xlsx`
- `REF_VAGAS_FILE=data/Quadro de Vagas Edital.xlsx`
- `REF_VAGAS_SHEET=Página1`
- `REF_VAGAS_HEADER_ROW=1`
- `REF_VAGAS_DATA_START_ROW=2`
- `REF_VAGAS_DATA_END_ROW=42`

Nao fixe `PORT` em ambiente gerenciado.

O servidor abre listeners em multiplas portas candidatas para compatibilidade com proxy gerenciado.
O banco SQLite usa `DATA_DIR` quando definido; em host gerenciado, prefira `/tmp/lotacoes-data`.

#### App 2: Frontend (`saude.palmas.online`)

Recomendado no painel do frontend:

- framework: Vite (ou static)
- branch: `main`
- diretorio raiz: `frontend`
- node: 18.x

Variavel de ambiente (frontend):

- `VITE_API_BASE=https://api.palmas.online`

Observacao: o frontend tambem possui fallback automatico para `https://api.palmas.online` quando rodando em `saude.palmas.online`.

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
- `DELETE /api/requests` (admin)

## Saidas

- Entradas de solicitacao com filtros por cargo/unidade/busca
- Exportacao CSV das entradas
- Metricas de base importada (servidores, vagas, solicitacoes)
