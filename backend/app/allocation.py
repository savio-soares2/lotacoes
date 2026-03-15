from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

import pandas as pd

from .models import AllocationRecord, Applicant, TieCase

DATE_COLUMNS = {
    "admission": ["data_admissao", "admissao", "admissão", "dt_admissao", "data de admissao"],
    "birth": ["data_nascimento", "nascimento", "dt_nascimento", "data de nascimento"],
}

TEXT_COLUMNS = {
    "name": ["nome", "servidor", "nome_servidor"],
    "identifier": ["id", "matricula", "matrícula", "cpf", "identificador"],
    "choice_1": ["opcao_1", "opção_1", "1_opcao", "1a_opcao", "primeira_opcao"],
    "choice_2": ["opcao_2", "opção_2", "2_opcao", "2a_opcao", "segunda_opcao"],
    "choice_3": ["opcao_3", "opção_3", "3_opcao", "3a_opcao", "terceira_opcao"],
}


def _normalize_col(name: str) -> str:
    return (
        name.strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace("/", "_")
    )


def _find_column(df: pd.DataFrame, aliases: list[str]) -> str:
    available = {_normalize_col(c): c for c in df.columns}
    for alias in aliases:
        key = _normalize_col(alias)
        if key in available:
            return available[key]
    raise ValueError(f"Coluna obrigatoria nao encontrada. Esperado um destes nomes: {aliases}")


def _format_date_br(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _describe_auto_criterion(used_age_tiebreak: bool) -> str:
    if used_age_tiebreak:
        return "Critério 1 (tempo de serviço), com Critério 2 (idade) para desempate"
    return "Critério 1 (tempo de serviço)"


def load_applicants_from_df(df: pd.DataFrame) -> list[Applicant]:
    if df.empty:
        raise ValueError("A planilha esta vazia.")

    col_name = _find_column(df, TEXT_COLUMNS["name"])
    col_identifier = _find_column(df, TEXT_COLUMNS["identifier"])
    col_admission = _find_column(df, DATE_COLUMNS["admission"])
    col_birth = _find_column(df, DATE_COLUMNS["birth"])
    col_c1 = _find_column(df, TEXT_COLUMNS["choice_1"])
    col_c2 = _find_column(df, TEXT_COLUMNS["choice_2"])
    col_c3 = _find_column(df, TEXT_COLUMNS["choice_3"])

    applicants: list[Applicant] = []

    for idx, row in df.iterrows():
        if pd.isna(row[col_name]):
            continue

        admission_dt = pd.to_datetime(row[col_admission], errors="coerce")
        birth_dt = pd.to_datetime(row[col_birth], errors="coerce")

        if pd.isna(admission_dt) or pd.isna(birth_dt):
            raise ValueError(
                f"Data invalida na linha {idx + 2}. Verifique data de admissao e data de nascimento."
            )

        choices = [
            str(row[col_c1]).strip(),
            str(row[col_c2]).strip(),
            str(row[col_c3]).strip(),
        ]

        applicants.append(
            Applicant(
                row_id=idx + 2,
                identifier=str(row[col_identifier]).strip(),
                name=str(row[col_name]).strip(),
                admission_date=admission_dt.date(),
                birth_date=birth_dt.date(),
                choices=choices,
                raw={k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()},
            )
        )

    return applicants


def allocate(
    applicants: list[Applicant],
    capacities: dict[str, int],
    reference_date: date | None = None,
) -> dict[str, Any]:
    reference = reference_date or date.today()

    allocated_ids: set[str] = set()
    manual_tie_ids: set[str] = set()
    reserved_slots: dict[str, int] = defaultdict(int)
    unit_allocated_count: dict[str, int] = defaultdict(int)

    allocations: list[AllocationRecord] = []
    tie_cases: list[TieCase] = []
    allocation_used_age_tiebreak: dict[str, bool] = {}

    by_choice: dict[int, dict[str, list[Applicant]]] = {
        1: defaultdict(list),
        2: defaultdict(list),
        3: defaultdict(list),
    }

    for applicant in applicants:
        for i in range(3):
            unit = applicant.choices[i]
            if unit:
                by_choice[i + 1][unit].append(applicant)

    for rank in (1, 2, 3):
        units = sorted(set(by_choice[rank].keys()) | set(capacities.keys()))
        for unit in units:
            capacity = capacities.get(unit, 0)
            remaining = capacity - unit_allocated_count[unit] - reserved_slots[unit]
            if remaining <= 0:
                continue

            candidates = [
                a
                for a in by_choice[rank].get(unit, [])
                if a.identifier not in allocated_ids and a.identifier not in manual_tie_ids
            ]
            if not candidates:
                continue

            score_groups: dict[tuple[int, int], list[Applicant]] = defaultdict(list)
            for c in candidates:
                service_days = (reference - c.admission_date).days
                age_days = (reference - c.birth_date).days
                score_groups[(service_days, age_days)].append(c)

            ordered_scores = sorted(score_groups.keys(), key=lambda x: (x[0], x[1]), reverse=True)
            service_count: dict[int, int] = defaultdict(int)
            for c in candidates:
                service_days = (reference - c.admission_date).days
                service_count[service_days] += 1

            for score in ordered_scores:
                group = sorted(score_groups[score], key=lambda x: x.name)
                if remaining <= 0:
                    break

                if len(group) <= remaining:
                    for g in group:
                        used_age_tiebreak = service_count[score[0]] > 1
                        allocations.append(
                            AllocationRecord(
                                applicant=g,
                                unit=unit,
                                choice_rank=rank,
                                service_days=score[0],
                                age_days=score[1],
                            )
                        )
                        allocation_used_age_tiebreak[g.identifier] = used_age_tiebreak
                        allocated_ids.add(g.identifier)
                        unit_allocated_count[unit] += 1
                        remaining -= 1
                else:
                    tie_cases.append(
                        TieCase(
                            unit=unit,
                            choice_rank=rank,
                            remaining_slots=remaining,
                            candidates=group,
                        )
                    )
                    for g in group:
                        manual_tie_ids.add(g.identifier)
                    reserved_slots[unit] += remaining
                    remaining = 0
                    break

    all_ids = {a.identifier for a in applicants}
    unallocated_ids = all_ids - allocated_ids - manual_tie_ids

    applicants_map = {a.identifier: a for a in applicants}
    allocation_map = {r.applicant.identifier: r for r in allocations}

    tie_map: dict[str, dict[str, Any]] = {}
    for t in tie_cases:
        for c in t.candidates:
            tie_map[c.identifier] = {
                "unidade": t.unit,
                "opcao": t.choice_rank,
                "vagas_em_disputa": t.remaining_slots,
            }

    allocation_rows = [
        {
            "identificador": r.applicant.identifier,
            "nome": r.applicant.name,
            "unidade": r.unit,
            "opcao_contemplada": r.choice_rank,
            "criterio_aplicado": _describe_auto_criterion(allocation_used_age_tiebreak.get(r.applicant.identifier, False)),
            "tempo_servico_dias": r.service_days,
            "idade_dias": r.age_days,
            "data_admissao": _format_date_br(r.applicant.admission_date),
            "data_nascimento": _format_date_br(r.applicant.birth_date),
        }
        for r in sorted(allocations, key=lambda x: (x.unit, x.choice_rank, -x.service_days, -x.age_days))
    ]

    tie_rows = []
    for t in tie_cases:
        for c in t.candidates:
            tie_rows.append(
                {
                    "identificador": c.identifier,
                    "nome": c.name,
                    "unidade": t.unit,
                    "opcao_em_analise": t.choice_rank,
                    "vagas_em_disputa": t.remaining_slots,
                    "criterio_aplicado": "Empate nos Critérios 1 e 2; exige desempate manual por distância",
                    "tempo_servico_dias": (reference - c.admission_date).days,
                    "idade_dias": (reference - c.birth_date).days,
                    "data_admissao": _format_date_br(c.admission_date),
                    "data_nascimento": _format_date_br(c.birth_date),
                }
            )

    unallocated_rows = [
        {
            "identificador": applicants_map[i].identifier,
            "nome": applicants_map[i].name,
            "motivo": "Sem vaga nas 3 opções após aplicação dos critérios",
            "opcao_1": applicants_map[i].choices[0],
            "opcao_2": applicants_map[i].choices[1],
            "opcao_3": applicants_map[i].choices[2],
        }
        for i in sorted(unallocated_ids)
    ]

    summary_by_unit = []
    for unit in sorted(capacities.keys()):
        total_capacity = capacities[unit]
        allocated_count = unit_allocated_count[unit]
        reserved_count = reserved_slots[unit]
        summary_by_unit.append(
            {
                "unidade": unit,
                "vagas_totais": total_capacity,
                "lotados_automatico": allocated_count,
                "reservadas_para_desempate_manual": reserved_count,
                "vagas_restantes": total_capacity - allocated_count - reserved_count,
            }
        )

    all_units = sorted(
        {
            unit
            for applicant in applicants
            for unit in applicant.choices
            if unit
        }
        | set(capacities.keys())
    )

    unit_request_rows: list[dict[str, Any]] = []
    for applicant in applicants:
        for rank, unit in enumerate(applicant.choices, start=1):
            if not unit:
                continue

            allocation = allocation_map.get(applicant.identifier)
            tie_info = tie_map.get(applicant.identifier)

            if allocation and allocation.unit == unit:
                resultado_unidade = "Lotado nesta unidade"
                criterio_auto = _describe_auto_criterion(allocation_used_age_tiebreak.get(applicant.identifier, False))
                detalhamento = (
                    f"Lotado nesta unidade na {allocation.choice_rank}ª opção. "
                    f"Aplicado {criterio_auto.lower()}."
                )
                criterio_final = criterio_auto
                unidade_final = allocation.unit
                opcao_final = allocation.choice_rank
            elif allocation and allocation.unit != unit:
                resultado_unidade = "Não lotado nesta unidade"
                criterio_auto = _describe_auto_criterion(allocation_used_age_tiebreak.get(applicant.identifier, False))
                detalhamento = (
                    f"Não lotado em {unit}. Foi lotado em {allocation.unit} na {allocation.choice_rank}ª opção. "
                    f"Aplicado {criterio_auto.lower()}."
                )
                criterio_final = criterio_auto
                unidade_final = allocation.unit
                opcao_final = allocation.choice_rank
            elif tie_info and tie_info["unidade"] == unit and tie_info["opcao"] == rank:
                resultado_unidade = "Em desempate manual nesta unidade"
                detalhamento = (
                    "Empatou nos Critérios 1 e 2 no limite de vagas desta unidade. "
                    "Encaminhado para desempate manual por distância."
                )
                criterio_final = "Empate nos Critérios 1 e 2; pendente de Critério 3 (distância)"
                unidade_final = "Pendente"
                opcao_final = "Pendente"
            elif tie_info and (tie_info["unidade"] != unit or tie_info["opcao"] != rank):
                resultado_unidade = "Não lotado nesta unidade"
                detalhamento = (
                    f"Não lotado em {unit}. Encaminhado para desempate manual em "
                    f"{tie_info['unidade']} na {tie_info['opcao']}ª opção."
                )
                criterio_final = "Empate nos Critérios 1 e 2; pendente de Critério 3 (distância)"
                unidade_final = tie_info["unidade"]
                opcao_final = tie_info["opcao"]
            else:
                resultado_unidade = "Não lotado nesta unidade"
                detalhamento = "Sem vaga após análise das 3 opções do servidor."
                criterio_final = "Sem contemplação por falta de vagas"
                unidade_final = "Não lotado"
                opcao_final = "Não lotado"

            unit_request_rows.append(
                {
                    "unidade_solicitada": unit,
                    "opcao_solicitada": rank,
                    "identificador": applicant.identifier,
                    "nome": applicant.name,
                    "data_admissao": _format_date_br(applicant.admission_date),
                    "data_nascimento": _format_date_br(applicant.birth_date),
                    "tempo_servico_dias": (reference - applicant.admission_date).days,
                    "idade_dias": (reference - applicant.birth_date).days,
                    "resultado_na_unidade": resultado_unidade,
                    "unidade_lotada_final": unidade_final,
                    "opcao_contemplada_final": opcao_final,
                    "criterio_resultado_final": criterio_final,
                    "detalhamento_resultado": detalhamento,
                }
            )

    solicitacoes_por_unidade: dict[str, list[dict[str, Any]]] = {}
    for unit in all_units:
        rows = [r for r in unit_request_rows if r["unidade_solicitada"] == unit]
        solicitacoes_por_unidade[unit] = sorted(
            rows,
            key=lambda r: (r["opcao_solicitada"], -r["tempo_servico_dias"], -r["idade_dias"], r["nome"]),
        )

    tie_percent = (len(manual_tie_ids) / len(applicants) * 100.0) if applicants else 0.0

    return {
        "resumo": {
            "total_servidores": len(applicants),
            "lotados_automaticamente": len(allocated_ids),
            "em_desempate_manual": len(manual_tie_ids),
            "nao_lotados": len(unallocated_ids),
            "percentual_desempate_manual": round(tie_percent, 2),
            "data_referencia_criterios": _format_date_br(reference),
        },
        "resumo_unidades": summary_by_unit,
        "lotacoes": allocation_rows,
        "desempate_manual": tie_rows,
        "nao_lotados": unallocated_rows,
        "solicitacoes_por_unidade": solicitacoes_por_unidade,
    }
