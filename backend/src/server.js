import "dotenv/config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import express from "express"
import cors from "cors"
import multer from "multer"
import helmet from "helmet"
import rateLimit from "express-rate-limit"

const app = express()
const trustProxy = Number(process.env.TRUST_PROXY || 0)
if (Number.isFinite(trustProxy) && trustProxy > 0) {
  app.set("trust proxy", trustProxy)
}
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
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(BACKEND_DIR, "data", "uploads"))
fs.mkdirSync(uploadDir, { recursive: true })
const corsOrigins = String(process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

const ALLOWED_UPLOAD_MIME = new Set(["application/pdf", "image/png", "image/jpeg"])
const isProduction = process.env.NODE_ENV === "production"

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Muitas tentativas de login. Tente novamente em alguns minutos." },
})

const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Muitas consultas realizadas. Aguarde e tente novamente." },
})

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Muitos envios em pouco tempo. Aguarde e tente novamente." },
})

function extensionFromMime(mimeType) {
  if (mimeType === "application/pdf") return ".pdf"
  if (mimeType === "image/png") return ".png"
  if (mimeType === "image/jpeg") return ".jpg"
  return ""
}

function hasValidFileSignature(filePath, mimeType) {
  const fd = fs.openSync(filePath, "r")
  try {
    const header = Buffer.alloc(8)
    const bytesRead = fs.readSync(fd, header, 0, 8, 0)
    if (bytesRead < 4) return false

    if (mimeType === "application/pdf") {
      return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46
    }

    if (mimeType === "image/png") {
      return (
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47 &&
        header[4] === 0x0d &&
        header[5] === 0x0a &&
        header[6] === 0x1a &&
        header[7] === 0x0a
      )
    }

    if (mimeType === "image/jpeg") {
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    }

    return false
  } finally {
    fs.closeSync(fd)
  }
}

function removeUploadedFiles(req) {
  const filesByField = req.files || {}
  for (const fileList of Object.values(filesByField)) {
    for (const file of fileList || []) {
      try {
        fs.unlinkSync(file.path)
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function removeStoredFiles(paths = []) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  let removed = 0

  for (const filePath of unique) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        removed += 1
      }
    } catch {
      // ignore cleanup errors
    }
  }

  return removed
}

const uploadRequiredDocs = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeExt = extensionFromMime(file.mimetype)
      const randomPart = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      cb(null, `${file.fieldname}-${randomPart}${safeExt || ".bin"}`)
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) {
      cb(new Error("Tipo de arquivo invalido. Use PDF, PNG ou JPG."))
      return
    }
    cb(null, true)
  },
  limits: {
    files: 2,
    fileSize: 5 * 1024 * 1024,
  },
}).fields([
  { name: "comprovante_endereco", maxCount: 1 },
  { name: "identidade", maxCount: 1 },
])

const services = {
  ready: false,
  startupError: null,
  authMiddleware: null,
  loginUser: null,
  clearSolicitacoes: null,
  deleteSolicitacoesByIds: null,
  createSolicitacao: null,
  getFilterOptions: null,
  getSolicitacaoById: null,
  getMetaCounts: null,
  hasSolicitacaoByMatricula: null,
  listQuadroVagasPublic: null,
  listAllSolicitacaoAttachments: null,
  listSolicitacaoAttachmentsByIds: null,
  listSolicitacoes: null,
  lookupServidor: null,
  recomputeAllocations: null,
  reloadReferenceData: null,
  unitsByCargo: null,
  normalizeCpf: null,
  normalizeMatricula: null,
  toCsv: null,
  buildRequestsReport: null,
}

function serviceUnavailable(res) {
  return res.status(503).json({
    detail: "Backend em inicializacao ou com erro de dependencias",
    startupError: isProduction ? null : services.startupError ? String(services.startupError.message || services.startupError) : null,
  })
}

async function initServices() {
  try {
    const auth = await import("./auth.js")
    const importers = await import("./importers.js")
    const db = await import("./db.js")
    const csv = await import("./csv.js")
    const reporting = await import("./reporting.js")

    services.authMiddleware = auth.authMiddleware
    services.loginUser = auth.loginUser

    services.clearSolicitacoes = importers.clearSolicitacoes
    services.deleteSolicitacoesByIds = importers.deleteSolicitacoesByIds
    services.createSolicitacao = importers.createSolicitacao
    services.getFilterOptions = importers.getFilterOptions
    services.getSolicitacaoById = importers.getSolicitacaoById
    services.getMetaCounts = importers.getMetaCounts
    services.hasSolicitacaoByMatricula = importers.hasSolicitacaoByMatricula
    services.listQuadroVagasPublic = importers.listQuadroVagasPublic
    services.listAllSolicitacaoAttachments = importers.listAllSolicitacaoAttachments
    services.listSolicitacaoAttachmentsByIds = importers.listSolicitacaoAttachmentsByIds
    services.listSolicitacoes = importers.listSolicitacoes
    services.lookupServidor = importers.lookupServidor
    services.recomputeAllocations = importers.recomputeAllocations
    services.reloadReferenceData = importers.reloadReferenceData
    services.unitsByCargo = importers.unitsByCargo

    services.normalizeCpf = db.normalizeCpf
    services.normalizeMatricula = db.normalizeMatricula
    services.toCsv = csv.toCsv
    services.buildRequestsReport = reporting.buildRequestsReport

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
    credentials: false,
  })
)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
)
app.use(express.json({ limit: "10mb" }))

app.get("/api/health", (_req, res) => {
  res.status(services.ready ? 200 : 503).json({
    status: services.ready ? "ok" : "degraded",
    startupError: isProduction ? null : services.startupError ? String(services.startupError.message || services.startupError) : null,
  })
})

app.get("/api/public/quadro-vagas", (_req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  const rows = services.listQuadroVagasPublic()
  return res.json({ rows })
})

app.post("/api/auth/login", authLimiter, (req, res) => {
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

app.get("/api/form/lookup", lookupLimiter, (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  const cpf = services.normalizeCpf(req.query.cpf)
  const matricula = services.normalizeMatricula(req.query.matricula)

  if (!cpf || !matricula) {
    return res.status(400).json({ detail: "Informe cpf e matricula" })
  }

  const servidor = services.lookupServidor(cpf, matricula)
  if (!servidor) {
    return res.status(404).json({ detail: "Dados nao encontrados" })
  }

  const unidades = services.unitsByCargo(servidor.cargo)

  return res.json({
    servidor: {
      nome: servidor.nome,
      cargo: servidor.cargo,
      lotacao: servidor.lotacao,
      vinculo: servidor.vinculo,
    },
    unidades_disponiveis: unidades,
  })
})

app.post("/api/form/submit", (req, res) => {
  submitLimiter(req, res, () => {
  uploadRequiredDocs(req, res, (uploadError) => {
    if (uploadError) {
      removeUploadedFiles(req)
      return res.status(400).json({ detail: uploadError.message || "Falha no upload dos anexos" })
    }

    try {
      if (!services.ready) return serviceUnavailable(res)
      const payload = req.body || {}
      const cpf = services.normalizeCpf(payload.cpf)
      const matricula = services.normalizeMatricula(payload.matricula)
      const endereco = String(payload.endereco ?? "").trim()

      const comprovanteEndereco = req.files?.comprovante_endereco?.[0]
      const identidade = req.files?.identidade?.[0]

      if (!cpf || !matricula) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "CPF e matricula sao obrigatorios" })
      }

      if (services.hasSolicitacaoByMatricula(matricula)) {
        removeUploadedFiles(req)
        return res.status(409).json({ detail: "Ja existe solicitacao para esta matricula" })
      }

      if (!endereco) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "Endereco e obrigatorio" })
      }

      if (!comprovanteEndereco || !identidade) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "Anexe comprovante de endereco e documento de identidade" })
      }

      if (!hasValidFileSignature(comprovanteEndereco.path, comprovanteEndereco.mimetype)) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "Comprovante de endereco invalido" })
      }

      if (!hasValidFileSignature(identidade.path, identidade.mimetype)) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "Documento de identidade invalido" })
      }

      const servidor = services.lookupServidor(cpf, matricula)
      if (!servidor) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "Servidor nao encontrado nas tabelas de referencia" })
      }

      const unidades = services.unitsByCargo(servidor.cargo)
      const allowSet = new Set(unidades.map((u) => u.unidade))

      const unidade1 = String(payload.unidade_1 ?? "").trim()
      const unidade2 = String(payload.unidade_2 ?? "").trim()
      const unidade3 = String(payload.unidade_3 ?? "").trim()

      if (!unidade1) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "A primeira opcao de unidade e obrigatoria" })
      }

      const selected = [unidade1, unidade2, unidade3].filter(Boolean)
      const unique = new Set(selected)
      if (unique.size !== selected.length) {
        removeUploadedFiles(req)
        return res.status(400).json({ detail: "As unidades selecionadas nao podem se repetir" })
      }

      for (const unidade of selected) {
        if (!allowSet.has(unidade)) {
          removeUploadedFiles(req)
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
        endereco,
        comprovante_endereco_nome: comprovanteEndereco.originalname,
        comprovante_endereco_caminho: comprovanteEndereco.path,
        identidade_nome: identidade.originalname,
        identidade_caminho: identidade.path,
      })
      services.recomputeAllocations()
      const atualizada = services.getSolicitacaoById(created.id)

      return res.status(201).json({ message: "Solicitacao enviada", id: created.id, solicitacao: atualizada })
    } catch (error) {
      removeUploadedFiles(req)
      return res.status(400).json({ detail: error.message || "Falha ao enviar solicitacao" })
    }
  })
  })
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

app.get("/api/reports/requests.docx", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin", "gestao"])(req, res, async () => {
    const filters = {
      q: req.query.q,
      cargo: req.query.cargo,
      unidade: req.query.unidade,
      status: req.query.status,
      limit: req.query.limit,
    }

    const rows = services.listSolicitacoes(filters)
    const report = await services.buildRequestsReport(rows, filters)

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    res.setHeader("Content-Disposition", "attachment; filename=solicitacoes.docx")
    return res.send(report)
  })
})

app.delete("/api/requests", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin"])(req, res, () => {
    const attachments = services.listAllSolicitacaoAttachments()
    const result = services.clearSolicitacoes()
    const filePaths = attachments.flatMap((row) => [row.comprovante_endereco_caminho, row.identidade_caminho])
    const anexosRemovidos = removeStoredFiles(filePaths)
    return res.json({ message: "Entradas limpas", total_removido: result.changes, anexos_removidos: anexosRemovidos })
  })
})

app.delete("/api/requests/selected", (req, res) => {
  if (!services.ready) return serviceUnavailable(res)
  return services.authMiddleware(["admin"])(req, res, () => {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : []
    const ids = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]

    if (!ids.length) {
      return res.status(400).json({ detail: "Informe ao menos um id valido para exclusao" })
    }

    const attachments = services.listSolicitacaoAttachmentsByIds(ids)
    const result = services.deleteSolicitacoesByIds(ids)
    const filePaths = attachments.flatMap((row) => [row.comprovante_endereco_caminho, row.identidade_caminho])
    const anexosRemovidos = removeStoredFiles(filePaths)
    services.recomputeAllocations()

    return res.json({
      message: "Entradas selecionadas removidas",
      total_removido: result.changes,
      anexos_removidos: anexosRemovidos,
    })
  })
})

function resolveFrontendDist() {
  const configuredRaw = String(process.env.FRONTEND_DIST || "").trim()
  const candidates = []

  if (configuredRaw) {
    const configured = path.isAbsolute(configuredRaw)
      ? configuredRaw
      : path.resolve(BACKEND_DIR, configuredRaw)
    candidates.push(configured)
  }

  candidates.push(path.resolve(BACKEND_DIR, "public"))

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate
    }
  }

  if (configuredRaw) {
    console.warn(`FRONTEND_DIST definido, mas index.html nao encontrado em: ${candidates[0]}`)
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
