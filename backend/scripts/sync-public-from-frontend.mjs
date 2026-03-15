import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(SCRIPT_DIR, "..")
const ROOT_DIR = path.resolve(BACKEND_DIR, "..")
const FRONTEND_DIR = path.resolve(ROOT_DIR, "frontend")
const FRONTEND_DIST = path.resolve(FRONTEND_DIR, "dist")
const BACKEND_PUBLIC = path.resolve(BACKEND_DIR, "public")

function run(command, args, cwd) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command
  let out = spawnSync(executable, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  })

  if (out.error && process.platform === "win32" && command === "npm") {
    out = spawnSync(command, args, {
      cwd,
      stdio: "inherit",
      shell: true,
    })
  }

  if (out.error) {
    console.error(`failed to run ${command}: ${out.error.message}`)
    process.exit(1)
  }

  if (out.status !== 0) {
    process.exit(out.status ?? 1)
  }
}

function copyDirRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry.name)
    const dstPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath)
      continue
    }

    if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcPath)
      fs.symlinkSync(linkTarget, dstPath)
      continue
    }

    fs.copyFileSync(srcPath, dstPath)
  }
}

if (!fs.existsSync(FRONTEND_DIR)) {
  console.error("frontend directory not found")
  process.exit(1)
}

if (!fs.existsSync(path.resolve(FRONTEND_DIR, "node_modules"))) {
  run("npm", ["ci"], FRONTEND_DIR)
}
run("npm", ["run", "build"], FRONTEND_DIR)

if (fs.existsSync(BACKEND_PUBLIC)) {
  fs.rmSync(BACKEND_PUBLIC, { recursive: true, force: true })
}
fs.mkdirSync(BACKEND_PUBLIC, { recursive: true })

copyDirRecursive(FRONTEND_DIST, BACKEND_PUBLIC)
console.log(`public synchronized: ${BACKEND_PUBLIC}`)
