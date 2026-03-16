import {
  AlignmentType,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx"

const COLUMN_LABELS = {
  identificador: "Identificador",
  nome: "Nome",
  unidade: "Unidade",
  opcao_contemplada: "Opção Contemplada",
  criterio_aplicado: "Critério Aplicado",
  tempo_servico_dias: "Tempo de Serviço (dias)",
  idade_dias: "Idade (dias)",
  data_admissao: "Data de Admissão",
  data_nascimento: "Data de Nascimento",
  opcao_em_analise: "Opção em Análise",
  vagas_em_disputa: "Vagas em Disputa",
  motivo: "Motivo",
  opcao_1: "1ª Opção",
  opcao_2: "2ª Opção",
  opcao_3: "3ª Opção",
  vagas_totais: "Vagas Totais",
  lotados_automatico: "Lotados Automaticamente",
  reservadas_para_desempate_manual: "Reservadas para Desempate Manual",
  vagas_restantes: "Vagas Restantes",
  unidade_solicitada: "Unidade Solicitada",
  opcao_solicitada: "Opção Solicitada",
  resultado_na_unidade: "Resultado na Unidade Solicitada",
  unidade_lotada_final: "Unidade de Lotação Final",
  opcao_contemplada_final: "Opção Contemplada Final",
  criterio_resultado_final: "Critério do Resultado Final",
  detalhamento_resultado: "Detalhamento do Resultado",
}

const SUMMARY_LABELS = {
  total_servidores: "Total de Servidores",
  lotados_automaticamente: "Lotados Automaticamente",
  em_desempate_manual: "Em Desempate Manual",
  nao_lotados: "Não Lotados",
  percentual_desempate_manual: "Percentual em Desempate Manual",
  data_referencia_criterios: "Data de Referência dos Critérios",
}

function heading(text, level = 1) {
  return new Paragraph({
    heading: `Heading${Math.min(3, Math.max(1, level))}`,
    children: [new TextRun(text)],
  })
}

function para(text) {
  return new Paragraph({ children: [new TextRun(String(text))] })
}

function buildTableRows(rows) {
  if (!rows.length) {
    return [new TableRow({ children: [new TableCell({ children: [para("Sem registros.")] })] })]
  }

  const headers = Object.keys(rows[0]).filter((h) => h !== "identificador")
  const header = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          children: [para(COLUMN_LABELS[h] ?? h)],
        })
    ),
  })

  const body = rows.map(
    (row) =>
      new TableRow({
        children: headers.map(
          (h) =>
            new TableCell({
              children: [para(row[h] ?? "")],
            })
        ),
      })
  )

  return [header, ...body]
}

function buildTable(rows) {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    rows: buildTableRows(rows),
  })
}

const REQUEST_COLUMNS = [
  ["id", "ID"],
  ["nome", "Nome"],
  ["cpf", "CPF"],
  ["matricula", "Matrícula"],
  ["cargo", "Cargo"],
  ["unidade_1", "1ª Opção"],
  ["unidade_2", "2ª Opção"],
  ["unidade_3", "3ª Opção"],
  ["resultado_status", "Status"],
  ["unidade_lotada_final", "Unidade Final"],
  ["opcao_contemplada_final", "Opção Contemplada"],
  ["criterio_resultado_final", "Critério"],
  ["detalhamento_resultado", "Detalhamento"],
  ["created_at", "Criado Em"],
  ["atualizado_em", "Atualizado Em"],
]

function normalizeCell(value) {
  if (value === null || value === undefined || value === "") return "-"
  return String(value)
}

function buildRequestsRows(rows) {
  const header = new TableRow({
    children: REQUEST_COLUMNS.map(([, label]) =>
      new TableCell({
        children: [para(label)],
      })
    ),
  })

  if (!rows.length) {
    return [
      header,
      new TableRow({
        children: [
          new TableCell({
            columnSpan: REQUEST_COLUMNS.length,
            children: [para("Sem registros para os filtros selecionados.")],
          }),
        ],
      }),
    ]
  }

  const body = rows.map(
    (row) =>
      new TableRow({
        children: REQUEST_COLUMNS.map(([key]) =>
          new TableCell({
            children: [para(normalizeCell(row[key]))],
          })
        ),
      })
  )

  return [header, ...body]
}

function buildRequestsTable(rows) {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    rows: buildRequestsRows(rows),
  })
}

export async function buildRequestsReport(rows, filters = {}) {
  const children = []
  children.push(heading("Relatório de Solicitações de Lotação", 1))
  children.push(para(`Gerado em: ${new Date().toLocaleString("pt-BR")}`))

  children.push(heading("Filtros Aplicados", 2))
  children.push(para(`Busca: ${normalizeCell(filters.q)}`))
  children.push(para(`Cargo: ${normalizeCell(filters.cargo)}`))
  children.push(para(`Unidade: ${normalizeCell(filters.unidade)}`))
  children.push(para(`Status: ${normalizeCell(filters.status)}`))

  children.push(heading("Resumo", 2))
  children.push(para(`Total de registros: ${rows.length}`))

  children.push(heading("Registros", 2))
  children.push(buildRequestsTable(rows))

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
            size: { orientation: PageOrientation.LANDSCAPE },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}

export async function buildReport(result) {
  const children = []
  children.push(heading("Relatório de Lotação de Servidores", 1))
  children.push(para(`Gerado em: ${new Date().toLocaleString("pt-BR")}`))

  children.push(heading("Critérios Utilizados", 2))
  children.push(para("1. Tempo de serviço (data de admissão mais antiga)."))
  children.push(para("2. Idade (data de nascimento mais antiga)."))
  children.push(para("3. Distância residência-unidade, apenas para os casos de desempate manual."))

  children.push(heading("Resumo Geral", 2))
  const resumo = result?.resumo ?? {}
  for (const [key, value] of Object.entries(resumo)) {
    const label = SUMMARY_LABELS[key] ?? key
    const text = key === "percentual_desempate_manual" ? `${label}: ${value}%` : `${label}: ${value}`
    children.push(para(text))
  }

  children.push(heading("Resumo por Unidade", 2))
  children.push(buildTable(result?.resumo_unidades ?? []))

  children.push(heading("Solicitações por Unidade", 2))
  const solicitacoes = result?.solicitacoes_por_unidade ?? {}
  const unidades = Object.keys(solicitacoes)
  if (!unidades.length) {
    children.push(para("Sem registros de solicitações por unidade."))
  } else {
    for (const unidade of unidades) {
      children.push(heading(`Unidade: ${unidade}`, 3))
      children.push(buildTable(solicitacoes[unidade] ?? []))
    }
  }

  children.push(heading("Casos para Desempate Manual", 2))
  children.push(buildTable(result?.desempate_manual ?? []))

  children.push(heading("Não Lotados", 2))
  children.push(buildTable(result?.nao_lotados ?? []))

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
            size: { orientation: PageOrientation.LANDSCAPE },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
