export function toCsv(rows) {
  if (!rows?.length) return ""

  const headers = Object.keys(rows[0])
  const escape = (value) => {
    const text = String(value ?? "")
    if (text.includes(";") || text.includes("\"") || text.includes("\n")) {
      return `\"${text.replaceAll("\"", "\"\"")}\"`
    }
    return text
  }

  const lines = [
    headers.join(";"),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(";")),
  ]

  return `\uFEFF${lines.join("\n")}`
}
