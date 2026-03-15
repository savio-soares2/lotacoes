import express from "express"

const app = express()
const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || "0.0.0.0"

app.get("/", (_req, res) => {
  res.status(200).send("probe-ok")
})

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", mode: "probe", port, host })
})

app.listen(port, host, () => {
  console.log(`[probe] listening on http://${host}:${port}`)
})
