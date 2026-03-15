import "dotenv/config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import express from "express"
import cors from "cors"

import { authMiddleware, loginUser } from "./auth.js"
import {
  clearSolicitacoes,
  createSolicitacao,
  getFilterOptions,
  getSolicitacaoById,
  getMetaCounts,
  listQuadroVagasPublic,
  listSolicitacoes,
  lookupServidor,
  recomputeAllocations,
  reloadReferenceData,
  unitsByCargo,
} from "./importers.js"
import { normalizeCpf, normalizeMatricula } from "./db.js"
import { toCsv } from "./csv.js"

const app = express()
const parsedPort = Number(process.env.PORT)
const primaryPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8000
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

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
)
app.use(express.json({ limit: "10mb" }))

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.get("/api/public/quadro-vagas", (_req, res) => {
  const rows = listQuadroVagasPublic()
  return res.json({ rows })
})

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {}
  const result = loginUser(username, password)
  if (!result) {
    return res.status(401).json({ detail: "Usuario ou senha invalidos" })
  }
  return res.json(result)
})

app.get("/api/auth/me", authMiddleware(["admin", "gestao"]), (req, res) => {
  return res.json({ user: req.user })
})

app.get("/api/meta", authMiddleware(["admin", "gestao"]), (_req, res) => {
  return res.json({
    ...getMetaCounts(),
    filtros: getFilterOptions(),
  })
})

app.post("/api/admin/reload-reference", authMiddleware(["admin"]), async (_req, res) => {
  try {
    const data = await reloadReferenceData()
    const lotacao = recomputeAllocations()
    return res.json({ message: "Base de referencia recarregada", ...data, lotacao, meta: getMetaCounts() })
  } catch (error) {
    return res.status(400).json({ detail: error.message || "Falha ao recarregar base" })
  }
})

app.get("/api/form/lookup", (req, res) => {
  const cpf = normalizeCpf(req.query.cpf)
  const matricula = normalizeMatricula(req.query.matricula)

  if (!cpf || !matricula) {
    return res.status(400).json({ detail: "Informe cpf e matricula" })
  }

  const servidor = lookupServidor(cpf, matricula)
  if (!servidor) {
    return res.status(404).json({ detail: "Servidor nao encontrado nas tabelas de referencia" })
  }

  const unidades = unitsByCargo(servidor.cargo)

  return res.json({
    servidor,
    unidades_disponiveis: unidades,
  })
})

app.post("/api/form/submit", (req, res) => {
  try {
    const payload = req.body || {}
    const cpf = normalizeCpf(payload.cpf)
    const matricula = normalizeMatricula(payload.matricula)

    if (!cpf || !matricula) {
      return res.status(400).json({ detail: "CPF e matricula sao obrigatorios" })
    }

    const servidor = lookupServidor(cpf, matricula)
    if (!servidor) {
      return res.status(400).json({ detail: "Servidor nao encontrado nas tabelas de referencia" })
    }

    const unidades = unitsByCargo(servidor.cargo)
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

    const created = createSolicitacao({
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
    recomputeAllocations()
    const atualizada = getSolicitacaoById(created.id)

    return res.status(201).json({ message: "Solicitacao enviada", id: created.id, solicitacao: atualizada })
  } catch (error) {
    return res.status(400).json({ detail: error.message || "Falha ao enviar solicitacao" })
  }
})

app.get("/api/requests", authMiddleware(["admin", "gestao"]), (req, res) => {
  const rows = listSolicitacoes({
    q: req.query.q,
    cargo: req.query.cargo,
    unidade: req.query.unidade,
    status: req.query.status,
    limit: req.query.limit,
  })
  return res.json({ rows })
})

app.get("/api/reports/requests.csv", authMiddleware(["admin", "gestao"]), (req, res) => {
  const rows = listSolicitacoes({
    q: req.query.q,
    cargo: req.query.cargo,
    unidade: req.query.unidade,
    status: req.query.status,
    limit: req.query.limit,
  })
  const csv = toCsv(rows)
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", "attachment; filename=solicitacoes.csv")
  return res.send(csv)
})

app.delete("/api/requests", authMiddleware(["admin"]), (_req, res) => {
  const result = clearSolicitacoes()
  return res.json({ message: "Entradas limpas", total_removido: result.changes })
})

function resolveFrontendDist() {
  const candidates = []

  if (process.env.FRONTEND_DIST) {
    const configured = path.isAbsolute(process.env.FRONTEND_DIST)
      ? process.env.FRONTEND_DIST
      : path.resolve(BACKEND_DIR, process.env.FRONTEND_DIST)
    candidates.push(configured)
  }

  candidates.push(path.resolve(BACKEND_DIR, "public"))
  candidates.push(path.resolve(BACKEND_DIR, "dist"))
  candidates.push(path.resolve(BACKEND_DIR, "../frontend/dist"))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate
    }
  }

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

function startListener(listenPort) {
  const server = app.listen(listenPort, host, () => {
    console.log(`API em execucao em http://${host}:${listenPort}`)
    if (hasFrontendBuild) {
      console.log(`Frontend estatico servido de: ${frontendDist}`)
    } else {
      console.log("Frontend estatico nao encontrado. Disponivel apenas /api/*")
    }
  })

  server.on("error", (error) => {
    console.warn(`Listener nao iniciado na porta ${listenPort}: ${error.message}`)
  })
}

const candidatePorts = [...new Set([primaryPort, ...fallbackPorts, 8000])]
for (const p of candidatePorts) {
  startListener(p)
}

reloadReferenceData().catch((error) => {
  console.error(`Falha ao carregar base de referencia: ${error.message}`)
})

try {
  recomputeAllocations()
} catch (error) {
  console.error(`Falha ao recalcular lotacoes na inicializacao: ${error.message}`)
}
