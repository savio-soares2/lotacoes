import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"

import { db } from "./db.js"

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production"
const JWT_EXPIRES_IN = "12h"
const isProduction = process.env.NODE_ENV === "production"

function isWeakJwtSecret(secret) {
  const normalized = String(secret || "").trim()
  return (
    normalized.length < 32 ||
    normalized === "dev-secret-change-in-production" ||
    normalized.toLowerCase().includes("change-me") ||
    normalized.toLowerCase().includes("replace-with")
  )
}

if (isProduction && isWeakJwtSecret(JWT_SECRET)) {
  throw new Error("JWT_SECRET fraco ou ausente em producao")
}

export function loginUser(username, password) {
  const user = db
    .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
    .get(String(username ?? "").trim())

  if (!user) return null
  const ok = bcrypt.compareSync(String(password ?? ""), user.password_hash)
  if (!ok) return null

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
  })

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  }
}

export function authMiddleware(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null

    if (!token) {
      return res.status(401).json({ detail: "Nao autenticado" })
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })
      req.user = payload
      if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
        return res.status(403).json({ detail: "Sem permissao" })
      }
      return next()
    } catch {
      return res.status(401).json({ detail: "Token invalido" })
    }
  }
}

export function getUserFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })
  } catch {
    return null
  }
}
