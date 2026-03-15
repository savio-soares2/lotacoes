import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import ExcelJS from "exceljs"

import { db, normalizeCpf, normalizeMatricula, normalizeText } from "./db.js"
import { allocate } from "./allocation.js"

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(SRC_DIR, "..")
const ROOT_DIR = path.resolve(BACKEND_DIR, "..")

function resolveReferenceFile(configValue, defaultRelativePath) {
  const raw = String(configValue || defaultRelativePath).trim()
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [
        path.resolve(BACKEND_DIR, raw),
        path.resolve(BACKEND_DIR, "data", raw),
        path.resolve(ROOT_DIR, raw),
        path.resolve(ROOT_DIR, "data", raw),
      ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return candidates[0]
}

const DEFAULT_SERVERS_FILE = resolveReferenceFile(
  process.env.REF_SERVERS_FILE,
  "data/UPAS POR CARGO - 13-03-2026.xlsx"
)
const DEFAULT_VAGAS_FILE = resolveReferenceFile(
  process.env.REF_VAGAS_FILE,
  "data/Quadro de Vagas Edital.xlsx"
)
const DEFAULT_VAGAS_SHEET = process.env.REF_VAGAS_SHEET || "Página1"
const VAGAS_HEADER_ROW = Number(process.env.REF_VAGAS_HEADER_ROW || 1)
const VAGAS_DATA_START_ROW = Number(process.env.REF_VAGAS_DATA_START_ROW || 2)
const VAGAS_DATA_END_ROW = Number(process.env.REF_VAGAS_DATA_END_ROW || 42)

function parseDateCell(value) {
  if (!value) return null
  const dt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 10)
}

function toInt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

async function readSheetRows(filePath, sheetName) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0]
  if (!worksheet) {
    throw new Error(`Aba nao encontrada: ${sheetName}`)
  }

  const headers = []
  const rows = []

  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim()
  })

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const obj = {}
    let hasValue = false
    for (let colNumber = 1; colNumber < headers.length; colNumber += 1) {
      const key = headers[colNumber]
      if (!key) continue
      const cellValue = row.getCell(colNumber).value
      const value = cellValue && typeof cellValue === "object" && "text" in cellValue ? cellValue.text : cellValue
      obj[key] = value
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasValue = true
      }
    }
    if (hasValue) {
      rows.push(obj)
    }
  }

  return rows
}

async function readMatrixSheets(filePath, preferredSheetName) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const selectedSheet =
    workbook.getWorksheet(preferredSheetName) ||
    workbook.getWorksheet(String(preferredSheetName).replace(/\s+/g, "")) ||
    workbook.worksheets[0]

  if (!selectedSheet) return []

  return [selectedSheet].map((worksheet) => {
    const matrix = []
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      const values = []
      for (let colNumber = 1; colNumber <= row.cellCount; colNumber += 1) {
        const cellValue = row.getCell(colNumber).value
        const value = cellValue && typeof cellValue === "object" && "text" in cellValue ? cellValue.text : cellValue
        values.push(value)
      }
      matrix.push(values)
    }
    return { sheetName: worksheet.name, matrix }
  })
}

export async function reloadReferenceData() {
  const nominalRows = await readSheetRows(DEFAULT_SERVERS_FILE, "NOMINAL")
  const matrixSheets = await readMatrixSheets(DEFAULT_VAGAS_FILE, DEFAULT_VAGAS_SHEET)

  const clearServidores = db.prepare("DELETE FROM servidores")
  const insertServidor = db.prepare(`
    INSERT OR REPLACE INTO servidores
      (matricula, cpf, nome, admissao, nascimento, cargo, cargo_norm, lotacao, vinculo, situacao, source_file)
    VALUES
      (@matricula, @cpf, @nome, @admissao, @nascimento, @cargo, @cargo_norm, @lotacao, @vinculo, @situacao, @source_file)
  `)

  const clearVagas = db.prepare("DELETE FROM vagas")
  const insertVaga = db.prepare(`
    INSERT INTO vagas (unidade, cargo, cargo_norm, vagas, source_file)
    VALUES (@unidade, @cargo, @cargo_norm, @vagas, @source_file)
  `)

  const tx = db.transaction(() => {
    clearServidores.run()
    clearVagas.run()

    for (const row of nominalRows) {
      const matricula = normalizeMatricula(row.MATRICULA)
      const cpf = normalizeCpf(row.CPF)
      const nome = String(row.NOME ?? "").trim()
      const cargo = String(row.CARGO ?? "").trim()
      if (!matricula || !cpf || !nome || !cargo) continue

      insertServidor.run({
        matricula,
        cpf,
        nome,
        admissao: parseDateCell(row["ADMISSÃO"]),
        nascimento: parseDateCell(row["DATA NASC."]),
        cargo,
        cargo_norm: normalizeText(cargo),
        lotacao: String(row["LOTAÇÃO"] ?? "").trim(),
        vinculo: String(row["VÍNCULO"] ?? "").trim(),
        situacao: String(row["SITUAÇÃO"] ?? "").trim(),
        source_file: `${DEFAULT_SERVERS_FILE}#NOMINAL`,
      })
    }

    for (const { sheetName, matrix } of matrixSheets) {
      const header = matrix[VAGAS_HEADER_ROW - 1] ?? []
      const cargos = header.slice(1).map((c) => String(c ?? "").replace(/\s+/g, " ").trim())

      const firstIndex = VAGAS_DATA_START_ROW - 1
      const lastIndex = Math.min(VAGAS_DATA_END_ROW - 1, matrix.length - 1)

      for (let i = firstIndex; i <= lastIndex; i += 1) {
        const row = matrix[i] ?? []
        const unidade = String(row[0] ?? "").replace(/\s+/g, " ").trim()
        if (!unidade || normalizeText(unidade) === "total") continue

        for (let col = 1; col < row.length; col += 1) {
          const cargo = cargos[col - 1]
          const vagas = toInt(row[col])
          if (!cargo || vagas <= 0) continue

          insertVaga.run({
            unidade,
            cargo,
            cargo_norm: normalizeText(cargo),
            vagas,
            source_file: `${DEFAULT_VAGAS_FILE}#${sheetName}`,
          })
        }
      }
    }
  })

  tx()

  const totalServidores = db.prepare("SELECT COUNT(1) AS total FROM servidores").get().total
  const totalVagas = db.prepare("SELECT COALESCE(SUM(vagas), 0) AS total FROM vagas").get().total

  return { totalServidores, totalVagas }
}

export function lookupServidor(cpf, matricula) {
  return db
    .prepare(
      `SELECT cpf, matricula, nome, admissao, nascimento, cargo, lotacao, vinculo, situacao
       FROM servidores
       WHERE cpf = ? AND matricula = ?
       LIMIT 1`
    )
    .get(normalizeCpf(cpf), normalizeMatricula(matricula))
}

export function unitsByCargo(cargo) {
  const cargoNorm = normalizeText(cargo)
  return db
    .prepare(
      `SELECT unidade, SUM(vagas) AS vagas
       FROM vagas
       WHERE cargo_norm = ?
       GROUP BY unidade
       HAVING SUM(vagas) > 0
       ORDER BY unidade`
    )
    .all(cargoNorm)
}

export function listQuadroVagasPublic() {
  return db
    .prepare(
      `SELECT unidade, cargo, SUM(vagas) AS vagas
       FROM vagas
       GROUP BY unidade, cargo
       HAVING SUM(vagas) > 0
       ORDER BY unidade ASC, cargo ASC`
    )
    .all()
}

export function createSolicitacao(payload) {
  const insert = db.prepare(`
    INSERT INTO solicitacoes
      (cpf, matricula, nome, admissao, nascimento, cargo, cargo_norm, unidade_1, unidade_2, unidade_3)
    VALUES
      (@cpf, @matricula, @nome, @admissao, @nascimento, @cargo, @cargo_norm, @unidade_1, @unidade_2, @unidade_3)
  `)

  const result = insert.run({
    cpf: normalizeCpf(payload.cpf),
    matricula: normalizeMatricula(payload.matricula),
    nome: String(payload.nome ?? "").trim(),
    admissao: payload.admissao || null,
    nascimento: payload.nascimento || null,
    cargo: String(payload.cargo ?? "").trim(),
    cargo_norm: normalizeText(payload.cargo),
    unidade_1: String(payload.unidade_1 ?? "").trim(),
    unidade_2: String(payload.unidade_2 ?? "").trim() || null,
    unidade_3: String(payload.unidade_3 ?? "").trim() || null,
  })

  return { id: result.lastInsertRowid }
}

function parseDateOrFallback(value, fallbackDate) {
  if (!value) return fallbackDate
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return fallbackDate
  return dt
}

export function recomputeAllocations() {
  const allRequests = db
    .prepare(
      `SELECT id, cpf, matricula, nome, admissao, nascimento, cargo, cargo_norm, unidade_1, unidade_2, unidade_3, created_at
       FROM solicitacoes
       ORDER BY datetime(created_at) ASC, id ASC`
    )
    .all()

  const allVagas = db
    .prepare(
      `SELECT cargo_norm, unidade, SUM(vagas) AS vagas
       FROM vagas
       GROUP BY cargo_norm, unidade`
    )
    .all()

  const capacitiesByCargo = new Map()
  for (const row of allVagas) {
    const cargoNorm = row.cargo_norm
    if (!capacitiesByCargo.has(cargoNorm)) capacitiesByCargo.set(cargoNorm, {})
    capacitiesByCargo.get(cargoNorm)[row.unidade] = Number(row.vagas ?? 0)
  }

  const requestsByCargo = new Map()
  for (const row of allRequests) {
    if (!requestsByCargo.has(row.cargo_norm)) requestsByCargo.set(row.cargo_norm, [])
    requestsByCargo.get(row.cargo_norm).push(row)
  }

  const statusById = new Map()

  for (const [cargoNorm, requests] of requestsByCargo.entries()) {
    const capacities = capacitiesByCargo.get(cargoNorm) ?? {}
    const applicants = requests.map((r) => {
      const fallback = new Date(r.created_at)
      return {
        identifier: String(r.id),
        name: r.nome,
        admissionDate: parseDateOrFallback(r.admissao, fallback),
        birthDate: parseDateOrFallback(r.nascimento, fallback),
        choices: [r.unidade_1, r.unidade_2 || "", r.unidade_3 || ""],
      }
    })

    const result = allocate(applicants, capacities, new Date())

    const allocated = new Map(result.lotacoes.map((r) => [String(r.identificador), r]))
    const ties = new Map(result.desempate_manual.map((r) => [String(r.identificador), r]))
    const unallocated = new Map(result.nao_lotados.map((r) => [String(r.identificador), r]))

    for (const req of requests) {
      const id = String(req.id)
      if (allocated.has(id)) {
        const row = allocated.get(id)
        statusById.set(id, {
          resultado_status: "lotado_automatico",
          unidade_lotada_final: row.unidade,
          opcao_contemplada_final: String(row.opcao_contemplada),
          criterio_resultado_final: row.criterio_aplicado,
          detalhamento_resultado: `Lotado automaticamente na unidade ${row.unidade} pela ${row.opcao_contemplada}a opcao.`,
          status: "processada",
        })
      } else if (ties.has(id)) {
        const row = ties.get(id)
        statusById.set(id, {
          resultado_status: "desempate_manual",
          unidade_lotada_final: row.unidade,
          opcao_contemplada_final: String(row.opcao_em_analise),
          criterio_resultado_final: row.criterio_aplicado,
          detalhamento_resultado: "Empate nos criterios automaticos. Necessario desempate manual.",
          status: "processada",
        })
      } else if (unallocated.has(id)) {
        statusById.set(id, {
          resultado_status: "nao_lotado",
          unidade_lotada_final: "Nao lotado",
          opcao_contemplada_final: "-",
          criterio_resultado_final: "Sem contemplacao por falta de vagas",
          detalhamento_resultado: "Sem vaga nas 3 opcoes apos aplicacao dos criterios.",
          status: "processada",
        })
      } else {
        statusById.set(id, {
          resultado_status: "pendente",
          unidade_lotada_final: "Pendente",
          opcao_contemplada_final: "-",
          criterio_resultado_final: "Aguardando processamento",
          detalhamento_resultado: "Solicitacao cadastrada e aguardando processamento.",
          status: "enviada",
        })
      }
    }
  }

  const update = db.prepare(
    `UPDATE solicitacoes
     SET
       status = @status,
       resultado_status = @resultado_status,
       unidade_lotada_final = @unidade_lotada_final,
       opcao_contemplada_final = @opcao_contemplada_final,
       criterio_resultado_final = @criterio_resultado_final,
       detalhamento_resultado = @detalhamento_resultado,
       atualizado_em = datetime('now')
     WHERE id = @id`
  )

  const tx = db.transaction(() => {
    for (const req of allRequests) {
      const status = statusById.get(String(req.id))
      if (!status) continue
      update.run({
        id: req.id,
        ...status,
      })
    }
  })
  tx()

  return {
    total: allRequests.length,
    lotado_automatico: [...statusById.values()].filter((s) => s.resultado_status === "lotado_automatico").length,
    desempate_manual: [...statusById.values()].filter((s) => s.resultado_status === "desempate_manual").length,
    nao_lotado: [...statusById.values()].filter((s) => s.resultado_status === "nao_lotado").length,
  }
}

export function getSolicitacaoById(id) {
  return db
    .prepare(
      `SELECT id, cpf, matricula, nome, admissao, nascimento, cargo, unidade_1, unidade_2, unidade_3,
              status, resultado_status, unidade_lotada_final, opcao_contemplada_final,
              criterio_resultado_final, detalhamento_resultado, atualizado_em, created_at
       FROM solicitacoes
       WHERE id = ?`
    )
    .get(Number(id))
}

export function listSolicitacoes(filters = {}) {
  const clauses = []
  const params = []

  if (filters.cargo) {
    clauses.push("cargo_norm = ?")
    params.push(normalizeText(filters.cargo))
  }
  if (filters.unidade) {
    clauses.push("(unidade_1 = ? OR unidade_2 = ? OR unidade_3 = ?)")
    params.push(filters.unidade, filters.unidade, filters.unidade)
  }
  if (filters.status) {
    clauses.push("resultado_status = ?")
    params.push(String(filters.status).trim())
  }
  if (filters.q) {
    clauses.push("(nome LIKE ? OR cpf LIKE ? OR matricula LIKE ?)")
    const q = `%${String(filters.q).trim()}%`
    params.push(q, q, q)
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Number.isInteger(Number(filters.limit)) ? Math.min(Number(filters.limit), 2000) : 500

  return db
    .prepare(
      `SELECT id, cpf, matricula, nome, admissao, nascimento, cargo, unidade_1, unidade_2, unidade_3,
              status, resultado_status, unidade_lotada_final, opcao_contemplada_final,
              criterio_resultado_final, detalhamento_resultado, atualizado_em, created_at
       FROM solicitacoes
       ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT ${limit}`
    )
    .all(...params)
}

export function clearSolicitacoes() {
  return db.prepare("DELETE FROM solicitacoes").run()
}

export function getMetaCounts() {
  const servidores = db.prepare("SELECT COUNT(1) AS total FROM servidores").get().total
  const vagas = db.prepare("SELECT COALESCE(SUM(vagas), 0) AS total FROM vagas").get().total
  const solicitacoes = db.prepare("SELECT COUNT(1) AS total FROM solicitacoes").get().total
  return { servidores, vagas, solicitacoes }
}

export function getFilterOptions() {
  const cargos = db
    .prepare(
      `SELECT DISTINCT cargo
       FROM vagas
       WHERE cargo IS NOT NULL AND trim(cargo) <> ''
       ORDER BY cargo ASC`
    )
    .all()
    .map((row) => row.cargo)

  const unidades = db
    .prepare(
      `SELECT DISTINCT unidade
       FROM vagas
       WHERE unidade IS NOT NULL AND trim(unidade) <> ''
       ORDER BY unidade ASC`
    )
    .all()
    .map((row) => row.unidade)

  const status = [
    { value: "lotado_automatico", label: "Lotado automático" },
    { value: "desempate_manual", label: "Desempate manual" },
    { value: "nao_lotado", label: "Não lotado" },
    { value: "pendente", label: "Pendente" },
  ]

  return { cargos, unidades, status }
}
