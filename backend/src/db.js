import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(SRC_DIR, "..")

function ensureWritableDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
  const probe = path.join(dirPath, ".write-test")
  fs.writeFileSync(probe, "ok")
  fs.unlinkSync(probe)
}

function resolveDatabaseDirectory() {
  const candidates = [
    process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null,
    path.resolve(BACKEND_DIR, "data"),
    path.resolve(os.tmpdir(), "lotacoes-data"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      ensureWritableDirectory(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }

  throw new Error("Nao foi possivel encontrar um diretorio gravavel para o banco SQLite")
}

const dbDir = resolveDatabaseDirectory()
const dbPath = path.join(dbDir, "app.db")
export const db = new Database(dbPath)

try {
  db.pragma("journal_mode = WAL")
} catch {
  db.pragma("journal_mode = DELETE")
}

console.log(`SQLite em uso: ${dbPath}`)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'gestao')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS servidores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matricula TEXT NOT NULL,
    cpf TEXT NOT NULL,
    nome TEXT NOT NULL,
    admissao TEXT,
    nascimento TEXT,
    cargo TEXT NOT NULL,
    cargo_norm TEXT NOT NULL,
    lotacao TEXT,
    vinculo TEXT,
    situacao TEXT,
    source_file TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cpf, matricula)
  );

  CREATE TABLE IF NOT EXISTS vagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unidade TEXT NOT NULL,
    cargo TEXT NOT NULL,
    cargo_norm TEXT NOT NULL,
    vagas INTEGER NOT NULL,
    source_file TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS solicitacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT NOT NULL,
    matricula TEXT NOT NULL,
    nome TEXT NOT NULL,
    admissao TEXT,
    nascimento TEXT,
    cargo TEXT NOT NULL,
    cargo_norm TEXT NOT NULL,
    unidade_1 TEXT NOT NULL,
    unidade_2 TEXT,
    unidade_3 TEXT,
    status TEXT NOT NULL DEFAULT 'enviada',
    resultado_status TEXT,
    unidade_lotada_final TEXT,
    opcao_contemplada_final TEXT,
    criterio_resultado_final TEXT,
    detalhamento_resultado TEXT,
    atualizado_em TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_servidores_cpf_matricula ON servidores(cpf, matricula);
  CREATE INDEX IF NOT EXISTS idx_vagas_cargo_norm ON vagas(cargo_norm);
  CREATE INDEX IF NOT EXISTS idx_solicitacoes_cargo_norm ON solicitacoes(cargo_norm);
`)

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  const exists = columns.some((c) => c.name === columnName)
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
  }
}

ensureColumn("solicitacoes", "resultado_status", "TEXT")
ensureColumn("solicitacoes", "unidade_lotada_final", "TEXT")
ensureColumn("solicitacoes", "opcao_contemplada_final", "TEXT")
ensureColumn("solicitacoes", "criterio_resultado_final", "TEXT")
ensureColumn("solicitacoes", "detalhamento_resultado", "TEXT")
ensureColumn("solicitacoes", "atualizado_em", "TEXT")
ensureColumn("solicitacoes", "endereco", "TEXT")
ensureColumn("solicitacoes", "comprovante_endereco_nome", "TEXT")
ensureColumn("solicitacoes", "comprovante_endereco_caminho", "TEXT")
ensureColumn("solicitacoes", "identidade_nome", "TEXT")
ensureColumn("solicitacoes", "identidade_caminho", "TEXT")

function seedUsers() {
  const count = db.prepare("SELECT COUNT(1) AS total FROM users").get().total
  if (count > 0) return

  const isProduction = process.env.NODE_ENV === "production"
  let adminUsername = String(process.env.ADMIN_BOOTSTRAP_USERNAME || "").trim()
  let adminPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "")

  if (!adminUsername || !adminPassword) {
    if (isProduction) {
      throw new Error("Defina ADMIN_BOOTSTRAP_USERNAME e ADMIN_BOOTSTRAP_PASSWORD para inicializar o primeiro usuario admin")
    }

    adminUsername = "admin"
    adminPassword = "admin123"
    console.warn("ADMIN_BOOTSTRAP_* ausente: usando usuario padrao apenas para ambiente nao produtivo")
  }

  const insert = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
  insert.run(adminUsername, bcrypt.hashSync(adminPassword, 12), "admin")

  const gestaoUsername = String(process.env.GESTAO_BOOTSTRAP_USERNAME || "").trim()
  const gestaoPassword = String(process.env.GESTAO_BOOTSTRAP_PASSWORD || "")
  if (gestaoUsername && gestaoPassword) {
    insert.run(gestaoUsername, bcrypt.hashSync(gestaoPassword, 12), "gestao")
  }
}

seedUsers()

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
}

export function normalizeCpf(value) {
  return String(value ?? "").replace(/\D/g, "")
}

export function normalizeMatricula(value) {
  return String(value ?? "").replace(/\D/g, "")
}
