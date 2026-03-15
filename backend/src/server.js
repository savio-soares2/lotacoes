import "dotenv/config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import express from "express"
import cors from "cors"

const app = express()
const rawPort = process.env.PORT
const primaryPort = (() => {
  if (rawPort === undefined || rawPort === "") return 8000
  const numeric = Number(rawPort)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : rawPort
})()
const host = process.env.HOST || "0.0.0.0"
const fallbackPorts = String(process.env.FALLBACK_PORTS || "3000,8080,5000")
  .split(",")
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isFinite(p) && p > 0)
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(SRC_DIR, "..")
const corsOrigins = String(process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

const services = {
  ready: false,
  startupError: null,
  authMiddleware: null,
  loginUser: null,
  clearSolicitacoes: null,
  createSolicitacao: null,
  getFilterOptions: null,
  getSolicitacaoById: null,
  getMetaCounts: null,
  listQuadroVagasPublic: null,
  listSolicitacoes: null,
  lookupServidor: null,
  recomputeAllocations: null,
  reloadReferenceData: null,
  unitsByCargo: null,
  normalizeCpf: null,
  normalizeMatricula: null,
  toCsv: null,
}

function serviceUnavailable(res) {
  return res.status(503).json({
    detail: "Backend em inicializacao ou com erro de dependencias",
    startupError: services.startupError ? String(services.startupError.message || services.startupError) : null,
  })
}

async function initServices() {
  try {
    const auth = await import("./auth.js")
    const importers = await import("./importers.js")
    const db = await import("./db.js")
    const csv = await import("./csv.js")

    services.authMiddleware = auth.authMiddleware
    services.loginUser = auth.loginUser

    services.clearSolicitacoes = importers.clearSolicitacoes
    services.createSolicitacao = importers.createSolicitacao
    services.getFilterOptions = importers.getFilterOptions
    services.getSolicitacaoById = importers.getSolicitacaoById
    services.getMetaCounts = importers.getMetaCounts
    services.listQuadroVagasPublic = importers.listQuadroVagasPublic
    services.listSolicitacoes = importers.listSolicitacoes
    services.lookupServidor = importers.lookupServidor
    services.recomputeAllocations = importers.recomputeAllocations
    services.reloadReferenceData = importers.reloadReferenceData
    services.unitsByCargo = importers.unitsByCargo

    services.normalizeCpf = db.normalizeCpf
    services.normalizeMatricula = db.normalizeMatricula
    services.toCsv = csv.toCsv

    await services.reloadReferenceData()
    services.recomputeAllocations()

    services.ready = true
    services.startupError = null
    console.log("Servicos internos inicializados com sucesso")
  } catch (error) {
    services.ready = false
    services.startupError = error
    console.error(`Falha na inicializacao de servicos: ${error.message}`)
  }
}

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
)
app.use(express.json({ limit: "10mb" }))

app.get("/api/health", (_req, res) => {
  res.status(services.ready ? 200 : 503).json({
    status: services.ready ? "ok" : "degraded",
    startupError: services.startupError ? String(services.startupError.message || services.startupError) : null,
  })
})

app.get("/api/public/quadro-vagas", (_req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  const rows = services.listQuadroVagasPublic()
  return res.json({ rows })
})

app.post("/api/auth/login", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  const { username, password } = req.body || {}
  const result = services.loginUser(username, password)
  if (!result) {
    return res.status(401).json({ detail: "Usuario ou senha invalidos" })
  }
  return res.json(result)
})

app.get("/api/auth/me", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin", "gestao"])(req, res, () => res.json({ user: req.user }))
})

app.get("/api/meta", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin", "gestao"])(req, res, () =>
    res.json({
      ...services.getMetaCounts(),
      filtros: services.getFilterOptions(),
    })
  )
})

app.post("/api/admin/reload-reference", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin"])(req, res, async () => {
    try {
      const data = await services.reloadReferenceData()
      const lotacao = services.recomputeAllocations()
      return res.json({ message: "Base de referencia recarregada", ...data, lotacao, meta: services.getMetaCounts() })
    } catch (error) {
      return res.status(400).json({ detail: error.message || "Falha ao recarregar base" })
    }
  })
})

app.get("/api/form/lookup", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  const cpf = services.normalizeCpf(req.query.cpf)
  const matricula = services.normalizeMatricula(req.query.matricula)

  if (!cpf || !matricula) {
    return res.status(400).json({ detail: "Informe cpf e matricula" })
  }

  const servidor = services.lookupServidor(cpf, matricula)
  if (!servidor) {
    return res.status(404).json({ detail: "Servidor nao encontrado nas tabelas de referencia" })
  }

  const unidades = services.unitsByCargo(servidor.cargo)

  return res.json({
    servidor,
    unidades_disponiveis: unidades,
  })
})

app.post("/api/form/submit", (req, res) => {
  try {
    if (!services.ready) return serviceUnavailable(res)
    const payload = req.body || {}
    const cpf = services.normalizeCpf(payload.cpf)
    const matricula = services.normalizeMatricula(payload.matricula)

    if (!cpf || !matricula) {
      return res.status(400).json({ detail: "CPF e matricula sao obrigatorios" })
    }

    const servidor = services.lookupServidor(cpf, matricula)
    if (!servidor) {
      return res.status(400).json({ detail: "Servidor nao encontrado nas tabelas de referencia" })
    }

    const unidades = services.unitsByCargo(servidor.cargo)
    const allowSet = new Set(unidades.map((u) => u.unidade))

    const unidade1 = String(payload.unidade_1 ?? "").trim()
    const unidade2 = String(payload.unidade_2 ?? "").trim()
    const unidade3 = String(payload.unidade_3 ?? "").trim()

    if (!unidade1) {
      return res.status(400).json({ detail: "A primeira opcao de unidade e obrigatoria" })
    }

    const selected = [unidade1, unidade2, unidade3].filter(Boolean)
    const unique = new Set(selected)
    if (unique.size !== selected.length) {
      return res.status(400).json({ detail: "As unidades selecionadas nao podem se repetir" })
    }

    for (const unidade of selected) {
      if (!allowSet.has(unidade)) {
        return res.status(400).json({ detail: `Unidade sem vaga para o cargo: ${unidade}` })
      }
    }

    const created = services.createSolicitacao({
      cpf,
      matricula,
      nome: servidor.nome,
      admissao: servidor.admissao,
      nascimento: servidor.nascimento,
      cargo: servidor.cargo,
      unidade_1: unidade1,
      unidade_2: unidade2,
      unidade_3: unidade3,
    })
    services.recomputeAllocations()
    const atualizada = services.getSolicitacaoById(created.id)

    return res.status(201).json({ message: "Solicitacao enviada", id: created.id, solicitacao: atualizada })
  } catch (error) {
    return res.status(400).json({ detail: error.message || "Falha ao enviar solicitacao" })
  }
})

app.get("/api/requests", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin", "gestao"])(req, res, () => {
    const rows = services.listSolicitacoes({
      q: req.query.q,
      cargo: req.query.cargo,
      unidade: req.query.unidade,
      status: req.query.status,
      limit: req.query.limit,
    })
    return res.json({ rows })
  })
})

app.get("/api/reports/requests.csv", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin", "gestao"])(req, res, () => {
    const rows = services.listSolicitacoes({
      q: req.query.q,
      cargo: req.query.cargo,
      unidade: req.query.unidade,
      status: req.query.status,
      limit: req.query.limit,
    })
    const csv = services.toCsv(rows)
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", "attachment; filename=solicitacoes.csv")
    return res.send(csv)
  })
})

app.delete("/api/requests", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin"])(req, res, () => {
    const result = services.clearSolicitacoes()
    return res.json({ message: "Entradas limpas", total_removido: result.changes })
  })
})

function resolveFrontendDist() {
  const configuredRaw = String(process.env.FRONTEND_DIST || "").trim()
  if (!configuredRaw) return null

  const configured = path.isAbsolute(configuredRaw)
    ? configuredRaw
    : path.resolve(BACKEND_DIR, configuredRaw)

  if (fs.existsSync(path.join(configured, "index.html"))) {
    return configured
  }

  console.warn(`FRONTEND_DIST definido, mas index.html nao encontrado em: ${configured}`)
  return null
}

const frontendDist = resolveFrontendDist()
const hasFrontendBuild = Boolean(frontendDist)

if (hasFrontendBuild) {
  app.use(express.static(frontendDist))

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next()
    return res.sendFile(path.join(frontendDist, "index.html"))
  })
}

function startListener(ports) {
  if (ports.length === 0) {
    console.error("Nenhuma porta disponivel para iniciar o servidor.")
    process.exit(1)
  }

  const listenPort = ports[0]
  const isSocket = typeof listenPort === "string" && isNaN(Number(listenPort))
  
  const callback = () => {
    console.log(`API em execucao em ${isSocket ? 'socket ' : 'http://' + host + ':'}${listenPort}`)
    if (hasFrontendBuild) {
      console.log(`Frontend estatico servido de: ${frontendDist}`)
    } else {
      console.log("Frontend estatico nao encontrado. Disponivel apenas /api/*")
    }
  }

  const server = isSocket 
    ? app.listen(listenPort, callback)
    : app.listen(listenPort, host, callback)

  server.on("error", (error) => {
    console.warn(`Listener nao iniciado na porta ${listenPort}: ${error.message}`)
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      console.log(`Tentando proxima porta...`)
      startListener(ports.slice(1))
    }
  })
}

const candidatePorts = [primaryPort, ...fallbackPorts, 8000].filter(Boolean)
const uniquePorts = [...new Set(candidatePorts)]

startListener(uniquePorts)

initServices()
