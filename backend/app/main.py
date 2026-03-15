from __future__ import annotations

import json
from datetime import date
from io import BytesIO

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .allocation import allocate, load_applicants_from_df
from .reporting import build_report

app = FastAPI(title="Sistema de Lotacoes", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/process")
async def process_spreadsheet(
    file: UploadFile = File(...),
    capacities_json: str = Form(...),
    reference_date: str | None = Form(None),
) -> dict:
    try:
        capacities = json.loads(capacities_json)
        if not isinstance(capacities, dict):
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="capacities_json invalido") from exc

    cleaned_capacities: dict[str, int] = {}
    for unit, value in capacities.items():
        try:
            cleaned_capacities[str(unit).strip()] = int(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Capacidade invalida para unidade: {unit}") from exc

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio")

    filename = file.filename.lower()
    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(BytesIO(content))
        else:
            df = pd.read_excel(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Erro ao ler planilha") from exc

    try:
        applicants = load_applicants_from_df(df)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    parsed_reference = None
    if reference_date:
        try:
            parsed_reference = date.fromisoformat(reference_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="reference_date deve estar no formato YYYY-MM-DD") from exc

    result = allocate(applicants, cleaned_capacities, parsed_reference)
    return result


@app.post("/api/report")
def generate_report(result: dict) -> StreamingResponse:
    report_bytes = build_report(result)
    return StreamingResponse(
        BytesIO(report_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": "attachment; filename=relatorio_lotacao.docx"},
    )
