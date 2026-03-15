import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(SCRIPT_DIR, "..")
const FRONTEND_DIR = path.resolve(BACKEND_DIR, "..", "frontend")
const FRONTEND_DIST = path.resolve(FRONTEND_DIR, "dist")

function run(command, args, cwd) {
  const out = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (out.status !== 0) {
    process.exit(out.status ?? 1)
  }
}

if (!fs.existsSync(FRONTEND_DIR)) {
  console.log("[ensure-frontend-build] frontend directory not found, skipping build")
  process.exit(0)
}

if (fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  console.log("[ensure-frontend-build] frontend dist already exists")
  process.exit(0)
}

console.log("[ensure-frontend-build] building frontend for unified deploy")
run("npm", ["ci", "--include=dev"], FRONTEND_DIR)
run("npm", ["run", "build"], FRONTEND_DIR)
