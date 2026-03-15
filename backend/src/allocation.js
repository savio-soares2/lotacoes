function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[-/]+/g, "_")
}

const DATE_COLUMNS = {
  admission: ["data_admissao", "admissao", "admissão", "dt_admissao", "data de admissao"],
  birth: ["data_nascimento", "nascimento", "dt_nascimento", "data de nascimento"],
}

const TEXT_COLUMNS = {
  name: ["nome", "servidor", "nome_servidor"],
  identifier: ["id", "matricula", "matrícula", "cpf", "identificador"],
  choice1: ["opcao_1", "opção_1", "1_opcao", "1a_opcao", "primeira_opcao"],
  choice2: ["opcao_2", "opção_2", "2_opcao", "2a_opcao", "segunda_opcao"],
  choice3: ["opcao_3", "opção_3", "3_opcao", "3a_opcao", "terceira_opcao"],
}

function findColumn(rows, aliases) {
  const first = rows[0] ?? {}
  const originalColumns = Object.keys(first)
  const map = new Map(originalColumns.map((col) => [normalizeText(col), col]))
  for (const alias of aliases) {
    const hit = map.get(normalizeText(alias))
    if (hit) return hit
  }
  throw new Error(`Coluna obrigatoria nao encontrada. Esperado um destes nomes: ${aliases.join(", ")}`)
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

function formatDateBr(date) {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const yyyy = date.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function describeAutoCriterion(usedAgeTiebreak) {
  if (usedAgeTiebreak) return "Criterio 1 (tempo de servico), com Criterio 2 (idade) para desempate"
  return "Criterio 1 (tempo de servico)"
}

function daysBetween(a, b) {
  const oneDay = 24 * 60 * 60 * 1000
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.floor((utcA - utcB) / oneDay)
}

export function loadApplicantsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("A planilha esta vazia.")
  }

  const colName = findColumn(rows, TEXT_COLUMNS.name)
  const colIdentifier = findColumn(rows, TEXT_COLUMNS.identifier)
  const colAdmission = findColumn(rows, DATE_COLUMNS.admission)
  const colBirth = findColumn(rows, DATE_COLUMNS.birth)
  const colC1 = findColumn(rows, TEXT_COLUMNS.choice1)
  const colC2 = findColumn(rows, TEXT_COLUMNS.choice2)
  const colC3 = findColumn(rows, TEXT_COLUMNS.choice3)

  const applicants = []

  rows.forEach((row, i) => {
    if (row[colName] === null || row[colName] === undefined || String(row[colName]).trim() === "") {
      return
    }

    const admissionDate = parseDate(row[colAdmission])
    const birthDate = parseDate(row[colBirth])

    if (!admissionDate || !birthDate) {
      throw new Error(`Data invalida na linha ${i + 2}. Verifique data de admissao e data de nascimento.`)
    }

    applicants.push({
      rowId: i + 2,
      identifier: String(row[colIdentifier] ?? "").trim(),
      name: String(row[colName] ?? "").trim(),
      admissionDate,
      birthDate,
      choices: [String(row[colC1] ?? "").trim(), String(row[colC2] ?? "").trim(), String(row[colC3] ?? "").trim()],
      raw: row,
    })
  })

  return applicants
}

export function allocate(applicants, capacities, referenceDate) {
  const reference = referenceDate ?? new Date()

  const allocatedIds = new Set()
  const manualTieIds = new Set()
  const reservedSlots = new Map()
  const unitAllocatedCount = new Map()

  const allocations = []
  const tieCases = []
  const allocationUsedAgeTiebreak = new Map()

  const byChoice = {
    1: new Map(),
    2: new Map(),
    3: new Map(),
  }

  for (const applicant of applicants) {
    for (let i = 0; i < 3; i += 1) {
      const unit = applicant.choices[i]
      if (!unit) continue
      const rank = i + 1
      if (!byChoice[rank].has(unit)) byChoice[rank].set(unit, [])
      byChoice[rank].get(unit).push(applicant)
    }
  }

  for (const rank of [1, 2, 3]) {
    const units = [...new Set([...byChoice[rank].keys(), ...Object.keys(capacities)])].sort((a, b) => a.localeCompare(b, "pt-BR"))

    for (const unit of units) {
      const totalCapacity = Number(capacities[unit] ?? 0)
      const allocatedCount = Number(unitAllocatedCount.get(unit) ?? 0)
      const reservedCount = Number(reservedSlots.get(unit) ?? 0)
      let remaining = totalCapacity - allocatedCount - reservedCount
      if (remaining <= 0) continue

      const candidates = (byChoice[rank].get(unit) ?? []).filter(
        (applicant) => !allocatedIds.has(applicant.identifier) && !manualTieIds.has(applicant.identifier)
      )
      if (!candidates.length) continue

      const scoreGroups = new Map()
      const serviceCount = new Map()

      for (const c of candidates) {
        const serviceDays = daysBetween(reference, c.admissionDate)
        const ageDays = daysBetween(reference, c.birthDate)
        const key = `${serviceDays}::${ageDays}`
        if (!scoreGroups.has(key)) scoreGroups.set(key, { serviceDays, ageDays, list: [] })
        scoreGroups.get(key).list.push(c)
        serviceCount.set(serviceDays, Number(serviceCount.get(serviceDays) ?? 0) + 1)
      }

      const orderedGroups = [...scoreGroups.values()].sort((a, b) => {
        if (b.serviceDays !== a.serviceDays) return b.serviceDays - a.serviceDays
        return b.ageDays - a.ageDays
      })

      for (const groupInfo of orderedGroups) {
        const group = [...groupInfo.list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        if (remaining <= 0) break

        if (group.length <= remaining) {
          for (const g of group) {
            const usedAgeTiebreak = Number(serviceCount.get(groupInfo.serviceDays) ?? 0) > 1
            allocations.push({
              applicant: g,
              unit,
              choiceRank: rank,
              serviceDays: groupInfo.serviceDays,
              ageDays: groupInfo.ageDays,
            })
            allocationUsedAgeTiebreak.set(g.identifier, usedAgeTiebreak)
            allocatedIds.add(g.identifier)
            unitAllocatedCount.set(unit, Number(unitAllocatedCount.get(unit) ?? 0) + 1)
            remaining -= 1
          }
        } else {
          tieCases.push({
            unit,
            choiceRank: rank,
            remainingSlots: remaining,
            candidates: group,
          })
          for (const g of group) manualTieIds.add(g.identifier)
          reservedSlots.set(unit, Number(reservedSlots.get(unit) ?? 0) + remaining)
          remaining = 0
          break
        }
      }
    }
  }

  const allIds = new Set(applicants.map((a) => a.identifier))
  const unallocatedIds = [...allIds].filter((id) => !allocatedIds.has(id) && !manualTieIds.has(id))

  const applicantsMap = new Map(applicants.map((a) => [a.identifier, a]))
  const allocationMap = new Map(allocations.map((r) => [r.applicant.identifier, r]))

  const tieMap = new Map()
  for (const t of tieCases) {
    for (const c of t.candidates) {
      tieMap.set(c.identifier, {
        unidade: t.unit,
        opcao: t.choiceRank,
        vagas_em_disputa: t.remainingSlots,
      })
    }
  }

  const allocationRows = allocations
    .sort((a, b) => {
      if (a.unit !== b.unit) return a.unit.localeCompare(b.unit, "pt-BR")
      if (a.choiceRank !== b.choiceRank) return a.choiceRank - b.choiceRank
      if (b.serviceDays !== a.serviceDays) return b.serviceDays - a.serviceDays
      return b.ageDays - a.ageDays
    })
    .map((r) => ({
      identificador: r.applicant.identifier,
      nome: r.applicant.name,
      unidade: r.unit,
      opcao_contemplada: r.choiceRank,
      criterio_aplicado: describeAutoCriterion(allocationUsedAgeTiebreak.get(r.applicant.identifier) ?? false),
      tempo_servico_dias: r.serviceDays,
      idade_dias: r.ageDays,
      data_admissao: formatDateBr(r.applicant.admissionDate),
      data_nascimento: formatDateBr(r.applicant.birthDate),
    }))

  const tieRows = []
  for (const t of tieCases) {
    for (const c of t.candidates) {
      tieRows.push({
        identificador: c.identifier,
        nome: c.name,
        unidade: t.unit,
        opcao_em_analise: t.choiceRank,
        vagas_em_disputa: t.remainingSlots,
        criterio_aplicado: "Empate nos Criterios 1 e 2; exige desempate manual por distancia",
        tempo_servico_dias: daysBetween(reference, c.admissionDate),
        idade_dias: daysBetween(reference, c.birthDate),
        data_admissao: formatDateBr(c.admissionDate),
        data_nascimento: formatDateBr(c.birthDate),
      })
    }
  }

  const unallocatedRows = unallocatedIds.sort((a, b) => a.localeCompare(b, "pt-BR")).map((id) => {
    const applicant = applicantsMap.get(id)
    return {
      identificador: applicant.identifier,
      nome: applicant.name,
      motivo: "Sem vaga nas 3 opcoes apos aplicacao dos criterios",
      opcao_1: applicant.choices[0],
      opcao_2: applicant.choices[1],
      opcao_3: applicant.choices[2],
    }
  })

  const summaryByUnit = Object.keys(capacities)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((unit) => {
      const totalCapacity = Number(capacities[unit] ?? 0)
      const allocatedCount = Number(unitAllocatedCount.get(unit) ?? 0)
      const reservedCount = Number(reservedSlots.get(unit) ?? 0)
      return {
        unidade: unit,
        vagas_totais: totalCapacity,
        lotados_automatico: allocatedCount,
        reservadas_para_desempate_manual: reservedCount,
        vagas_restantes: totalCapacity - allocatedCount - reservedCount,
      }
    })

  const allUnits = [...new Set([...Object.keys(capacities), ...applicants.flatMap((a) => a.choices).filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  )

  const unitRequestRows = []
  for (const applicant of applicants) {
    applicant.choices.forEach((unit, index) => {
      if (!unit) return
      const rank = index + 1

      const allocation = allocationMap.get(applicant.identifier)
      const tieInfo = tieMap.get(applicant.identifier)

      let resultadoUnidade
      let detalhamento
      let criterioFinal
      let unidadeFinal
      let opcaoFinal

      if (allocation && allocation.unit === unit) {
        resultadoUnidade = "Lotado nesta unidade"
        const criterioAuto = describeAutoCriterion(allocationUsedAgeTiebreak.get(applicant.identifier) ?? false)
        detalhamento = `Lotado nesta unidade na ${allocation.choiceRank}a opcao. Aplicado ${criterioAuto.toLowerCase()}.`
        criterioFinal = criterioAuto
        unidadeFinal = allocation.unit
        opcaoFinal = allocation.choiceRank
      } else if (allocation && allocation.unit !== unit) {
        resultadoUnidade = "Nao lotado nesta unidade"
        const criterioAuto = describeAutoCriterion(allocationUsedAgeTiebreak.get(applicant.identifier) ?? false)
        detalhamento = `Nao lotado em ${unit}. Foi lotado em ${allocation.unit} na ${allocation.choiceRank}a opcao. Aplicado ${criterioAuto.toLowerCase()}.`
        criterioFinal = criterioAuto
        unidadeFinal = allocation.unit
        opcaoFinal = allocation.choiceRank
      } else if (tieInfo && tieInfo.unidade === unit && tieInfo.opcao === rank) {
        resultadoUnidade = "Em desempate manual nesta unidade"
        detalhamento = "Empatou nos Criterios 1 e 2 no limite de vagas desta unidade. Encaminhado para desempate manual por distancia."
        criterioFinal = "Empate nos Criterios 1 e 2; pendente de Criterio 3 (distancia)"
        unidadeFinal = "Pendente"
        opcaoFinal = "Pendente"
      } else if (tieInfo && (tieInfo.unidade !== unit || tieInfo.opcao !== rank)) {
        resultadoUnidade = "Nao lotado nesta unidade"
        detalhamento = `Nao lotado em ${unit}. Encaminhado para desempate manual em ${tieInfo.unidade} na ${tieInfo.opcao}a opcao.`
        criterioFinal = "Empate nos Criterios 1 e 2; pendente de Criterio 3 (distancia)"
        unidadeFinal = tieInfo.unidade
        opcaoFinal = tieInfo.opcao
      } else {
        resultadoUnidade = "Nao lotado nesta unidade"
        detalhamento = "Sem vaga apos analise das 3 opcoes do servidor."
        criterioFinal = "Sem contemplacao por falta de vagas"
        unidadeFinal = "Nao lotado"
        opcaoFinal = "Nao lotado"
      }

      unitRequestRows.push({
        unidade_solicitada: unit,
        opcao_solicitada: rank,
        identificador: applicant.identifier,
        nome: applicant.name,
        data_admissao: formatDateBr(applicant.admissionDate),
        data_nascimento: formatDateBr(applicant.birthDate),
        tempo_servico_dias: daysBetween(reference, applicant.admissionDate),
        idade_dias: daysBetween(reference, applicant.birthDate),
        resultado_na_unidade: resultadoUnidade,
        unidade_lotada_final: unidadeFinal,
        opcao_contemplada_final: opcaoFinal,
        criterio_resultado_final: criterioFinal,
        detalhamento_resultado: detalhamento,
      })
    })
  }

  const solicitacoesPorUnidade = {}
  for (const unit of allUnits) {
    const rows = unitRequestRows.filter((r) => r.unidade_solicitada === unit)
    solicitacoesPorUnidade[unit] = rows.sort((a, b) => {
      if (a.opcao_solicitada !== b.opcao_solicitada) return a.opcao_solicitada - b.opcao_solicitada
      if (b.tempo_servico_dias !== a.tempo_servico_dias) return b.tempo_servico_dias - a.tempo_servico_dias
      if (b.idade_dias !== a.idade_dias) return b.idade_dias - a.idade_dias
      return a.nome.localeCompare(b.nome, "pt-BR")
    })
  }

  const tiePercent = applicants.length ? (manualTieIds.size / applicants.length) * 100 : 0

  return {
    resumo: {
      total_servidores: applicants.length,
      lotados_automaticamente: allocatedIds.size,
      em_desempate_manual: manualTieIds.size,
      nao_lotados: unallocatedIds.length,
      percentual_desempate_manual: Number(tiePercent.toFixed(2)),
      data_referencia_criterios: formatDateBr(reference),
    },
    resumo_unidades: summaryByUnit,
    lotacoes: allocationRows,
    desempate_manual: tieRows,
    nao_lotados: unallocatedRows,
    solicitacoes_por_unidade: solicitacoesPorUnidade,
  }
}
