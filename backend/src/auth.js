import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"

import { db } from "./db.js"

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production"
const JWT_EXPIRES_IN = "12h"

export function loginUser(username, password) {
  const user = db
    .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
    .get(String(username ?? "").trim())

  if (!user) return null
  const ok = bcrypt.compareSync(String(password ?? ""), user.password_hash)
  if (!ok) return null

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
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
      const payload = jwt.verify(token, JWT_SECRET)
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
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}
