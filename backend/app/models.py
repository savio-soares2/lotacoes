from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass
class Applicant:
    row_id: int
    identifier: str
    name: str
    admission_date: date
    birth_date: date
    choices: list[str]
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def service_days(self) -> int:
        return (date.today() - self.admission_date).days

    @property
    def age_days(self) -> int:
        return (date.today() - self.birth_date).days


@dataclass
class AllocationRecord:
    applicant: Applicant
    unit: str
    choice_rank: int
    service_days: int
    age_days: int


@dataclass
class TieCase:
    unit: str
    choice_rank: int
    remaining_slots: int
    candidates: list[Applicant]
