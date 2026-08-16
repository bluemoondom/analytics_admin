"""Export services for dashboard data."""

from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font


def export_table_to_excel(
    columns: list[str],
    rows: list[dict[str, Any]],
    column_aliases: dict[str, str] | None = None,
    sheet_name: str = "Data",
) -> bytes:
    """Export table data to an Excel workbook and return the file bytes."""
    aliases = column_aliases or {}
    wb = Workbook()
    ws = wb.active
    if ws is None:
        raise RuntimeError("Unable to create workbook sheet")
    ws.title = sheet_name

    headers = [aliases.get(col, col) for col in columns]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for row in rows:
        ws.append([row.get(col) for col in columns])

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    return stream.read()
