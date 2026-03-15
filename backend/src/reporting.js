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
  opcao_contemplada: "Opcao Contemplada",
  criterio_aplicado: "Criterio Aplicado",
  tempo_servico_dias: "Tempo de Servico (dias)",
  idade_dias: "Idade (dias)",
  data_admissao: "Data de Admissao",
  data_nascimento: "Data de Nascimento",
  opcao_em_analise: "Opcao em Analise",
  vagas_em_disputa: "Vagas em Disputa",
  motivo: "Motivo",
  opcao_1: "1a Opcao",
  opcao_2: "2a Opcao",
  opcao_3: "3a Opcao",
  vagas_totais: "Vagas Totais",
  lotados_automatico: "Lotados Automaticamente",
  reservadas_para_desempate_manual: "Reservadas para Desempate Manual",
  vagas_restantes: "Vagas Restantes",
  unidade_solicitada: "Unidade Solicitada",
  opcao_solicitada: "Opcao Solicitada",
  resultado_na_unidade: "Resultado na Unidade Solicitada",
  unidade_lotada_final: "Unidade de Lotacao Final",
  opcao_contemplada_final: "Opcao Contemplada Final",
  criterio_resultado_final: "Criterio do Resultado Final",
  detalhamento_resultado: "Detalhamento do Resultado",
}

const SUMMARY_LABELS = {
  total_servidores: "Total de Servidores",
  lotados_automaticamente: "Lotados Automaticamente",
  em_desempate_manual: "Em Desempate Manual",
  nao_lotados: "Nao Lotados",
  percentual_desempate_manual: "Percentual em Desempate Manual",
  data_referencia_criterios: "Data de Referencia dos Criterios",
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

export async function buildReport(result) {
  const children = []
  children.push(heading("Relatorio de Lotacao de Servidores", 1))
  children.push(para(`Gerado em: ${new Date().toLocaleString("pt-BR")}`))

  children.push(heading("Criterios Utilizados", 2))
  children.push(para("1. Tempo de servico (data de admissao mais antiga)."))
  children.push(para("2. Idade (data de nascimento mais antiga)."))
  children.push(para("3. Distancia residencia-unidade, apenas para os casos de desempate manual."))

  children.push(heading("Resumo Geral", 2))
  const resumo = result?.resumo ?? {}
  for (const [key, value] of Object.entries(resumo)) {
    const label = SUMMARY_LABELS[key] ?? key
    const text = key === "percentual_desempate_manual" ? `${label}: ${value}%` : `${label}: ${value}`
    children.push(para(text))
  }

  children.push(heading("Resumo por Unidade", 2))
  children.push(buildTable(result?.resumo_unidades ?? []))

  children.push(heading("Solicitacoes por Unidade", 2))
  const solicitacoes = result?.solicitacoes_por_unidade ?? {}
  const unidades = Object.keys(solicitacoes)
  if (!unidades.length) {
    children.push(para("Sem registros de solicitacoes por unidade."))
  } else {
    for (const unidade of unidades) {
      children.push(heading(`Unidade: ${unidade}`, 3))
      children.push(buildTable(solicitacoes[unidade] ?? []))
    }
  }

  children.push(heading("Casos para Desempate Manual", 2))
  children.push(buildTable(result?.desempate_manual ?? []))

  children.push(heading("Nao Lotados", 2))
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
