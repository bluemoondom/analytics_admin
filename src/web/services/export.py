"""Export services for dashboard data."""

from __future__ import annotations

import io
from typing import Any

import pandas as pd
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


def export_pivot_to_excel(
    detail_columns: list[str],
    detail_rows: list[dict[str, Any]],
    pivot_columns: list[str],
    pivot_rows: list[dict[str, Any]],
    dimension_columns: list[str],
    aggregations: dict[str, str],
    column_aliases: dict[str, str] | None = None,
    data_sheet_name: str = "Data",
    pivot_sheet_name: str = "Kontingence",
) -> bytes:
    """Export dashboard data with a separate pivot-like sheet.

    Two sheets are produced:
    - ``Data`` contains the full detail rows used as the source.
    - ``Kontingence`` contains a static pivot table built from the already
      aggregated rows returned by the dashboard query.  The rows are grouped
      by ``dimension_columns`` (outer-most first), first-dimension cells are
      merged, and sub-totals are inserted for each dimension level.

    Parameters
    ----------
    detail_columns:
        Column names for the detail/data sheet.
    detail_rows:
        Raw detail records.  If not available, ``pivot_rows`` can be passed
        here as well; the sheet is still usable as a source list.
    pivot_columns:
        Column names of the aggregated pivot rows returned by the query.
    pivot_rows:
        Aggregated rows used to render the pivot table.
    dimension_columns:
        Columns that define the row hierarchy in the pivot table.
    aggregations:
        Mapping ``column -> aggregation function`` for measure columns.
    column_aliases:
        Optional display names for columns.
    data_sheet_name:
        Name of the sheet with the source data.
    pivot_sheet_name:
        Name of the sheet with the pivot table.
    """
    aliases = column_aliases or {}
    wb = Workbook()

    # ------------------------------------------------------------------
    # Data sheet
    # ------------------------------------------------------------------
    data_ws = wb.active
    if data_ws is None:
        raise RuntimeError("Unable to create workbook sheet")
    data_ws.title = data_sheet_name

    detail_headers = [aliases.get(col, col) for col in detail_columns]
    data_ws.append(detail_headers)
    for cell in data_ws[1]:
        cell.font = Font(bold=True)
    for row in detail_rows:
        data_ws.append([row.get(col) for col in detail_columns])

    # ------------------------------------------------------------------
    # Pivot sheet
    # ------------------------------------------------------------------
    pivot_ws = wb.create_sheet(title=pivot_sheet_name)

    dims = [col for col in dimension_columns if col in pivot_columns]
    measure_cols = [col for col in pivot_columns if aggregations.get(col) in {"sum", "count", "avg", "min", "max"}]
    attr_cols = [col for col in pivot_columns if col not in dims and col not in measure_cols]

    # Determine output column order.
    output_cols = dims + measure_cols + attr_cols
    output_headers = [aliases.get(col, col) for col in output_cols]

    # If no dimensions or no measures are present, fall back to a plain table.
    if not dims or not measure_cols:
        pivot_ws.append(output_headers)
        for cell in pivot_ws[1]:
            cell.font = Font(bold=True)
        for row in pivot_rows:
            pivot_ws.append([row.get(col) for col in output_cols])
        _autosize_columns(pivot_ws)
        _autosize_columns(data_ws)
        return _workbook_bytes(wb)

    df = pd.DataFrame(pivot_rows, columns=pivot_columns)
    for col in measure_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    agg_map = _build_agg_map(measure_cols, aggregations)
    pivot = df.groupby(dims, sort=True).agg(agg_map).reset_index()
    if attr_cols:
        attr_data = df.groupby(dims, sort=True).first().reset_index()[dims + attr_cols]
        pivot = pivot.merge(attr_data, on=dims, how="left", suffixes=("", "_attr"))

    pivot_ws.append(output_headers)
    for cell in pivot_ws[1]:
        cell.font = Font(bold=True)

    rows, merge_ranges = _build_pivot_layout(pivot, dims, measure_cols, attr_cols)
    for row in rows:
        pivot_ws.append(row)
    for start, end in merge_ranges:
        if end > start:
            pivot_ws.merge_cells(start_row=start, start_column=1, end_row=end, end_column=1)

    _autosize_columns(data_ws)
    _autosize_columns(pivot_ws)
    return _workbook_bytes(wb)


def _build_agg_map(measure_cols: list[str], aggregations: dict[str, str]) -> dict[str, str]:
    """Return a pandas aggregation map for measure columns."""
    agg_map: dict[str, str] = {}
    for col in measure_cols:
        agg = aggregations.get(col, "sum").strip().lower()
        if agg in {"sum", "count", "avg", "min", "max"}:
            agg_map[col] = agg
        else:
            agg_map[col] = "sum"
    return agg_map


def _build_pivot_layout(
    pivot: pd.DataFrame,
    dims: list[str],
    measure_cols: list[str],
    attr_cols: list[str],
    subtotal_label: str = "Součet",
) -> tuple[list[list[Any]], list[tuple[int, int]]]:
    """Build rows for the pivot sheet and first-dimension merge ranges.

    Rows are grouped by dimensions from outer to inner.  A sub-total row is
    inserted after each group except the inner-most one, and a grand-total row
    is appended at the end.  For the outer-most dimension the cells with the
    same value are merged vertically over the data rows only.
    """
    rows: list[list[Any]] = []
    merge_ranges: list[tuple[int, int]] = []
    current_first_dim: Any = None
    merge_start_row: int | None = None

    def emit(row: list[Any]) -> int:
        nonlocal merge_start_row, current_first_dim
        rows.append(row)
        row_idx = len(rows) + 1  # +1 because header is row 1
        if len(dims) > 0:
            value = row[0]
            if value != current_first_dim:
                if merge_start_row is not None and row_idx - 1 > merge_start_row:
                    merge_ranges.append((merge_start_row, row_idx - 1))
                current_first_dim = value
                merge_start_row = row_idx
        return row_idx

    def recurse(level: int, group: pd.DataFrame) -> None:
        if level == len(dims):
            for _, r in group.iterrows():
                emit([r[c] for c in dims + measure_cols + attr_cols])
            return

        dim = dims[level]
        for value, sub in group.groupby(dim, sort=True):
            recurse(level + 1, sub)
            # Sub-total for the current group, but not for the inner-most dimension.
            if level < len(dims) - 1:
                sub_row = [value if i == level else subtotal_label if i > level else "" for i in range(len(dims))]
                sub_row += [sub[m].sum() for m in measure_cols]
                sub_row += [""] * len(attr_cols)
                emit(sub_row)

    recurse(0, pivot)

    if merge_start_row is not None:
        final_row = len(rows) + 1
        if final_row > merge_start_row:
            merge_ranges.append((merge_start_row, final_row))

    if len(pivot) > 0:
        grand_row = [subtotal_label] * len(dims)
        grand_row += [pivot[m].sum() for m in measure_cols]
        grand_row += [""] * len(attr_cols)
        rows.append(grand_row)

    return rows, merge_ranges


def _autosize_columns(ws: Any) -> None:
    """Set column widths based on content length."""
    for column_cells in ws.columns:
        max_length = 0
        col_letter = column_cells[0].column_letter
        for cell in column_cells:
            if cell.value is None:
                continue
            length = len(str(cell.value))
            max_length = max(max_length, length)
        ws.column_dimensions[col_letter].width = min(max(max_length + 2, 8), 50)


def _workbook_bytes(wb: Workbook) -> bytes:
    """Save an openpyxl workbook to a byte stream."""
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    return stream.read()
