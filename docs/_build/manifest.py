#!/usr/bin/env python3
"""Generate `tables.json` (a manifest of all CSV files under variables/ and
values/) for the terminag GitHub Pages site.

Usage:
    python3 docs/_build/manifest.py <site_root>

`<site_root>` must already contain copies of the `variables/` and `values/`
folders (plus any top-level `variables_*.csv` / `values_*.csv` files); the
script writes `<site_root>/tables.json`.
"""
from __future__ import annotations

import csv
import json
import os
import sys


def _info(path: str) -> tuple[list[str], int]:
	"""Return (header, data_row_count) for a CSV.

	Raises with a clear, locatable message if the file is not valid UTF-8 or
	cannot be parsed -- so encoding regressions surface at build time instead
	of producing a silently-empty entry in `tables.json`.

	Phantom columns (header cell is blank/whitespace AND every data cell in
	the column is blank/whitespace) are dropped from the reported column
	count. This matches what the in-browser renderer does so the column
	number shown on the index card agrees with what users see.
	"""
	try:
		with open(path, newline="", encoding="utf-8") as f:
			reader = csv.reader(f)
			header = next(reader, [])
			data_rows = list(reader)
	except UnicodeDecodeError as e:
		raise SystemExit(
			f"manifest: {path}: not valid UTF-8 at byte {e.start}: "
			f"{e.reason}. Re-save the file as UTF-8 (no BOM)."
		) from e
	except Exception as e:
		raise SystemExit(f"manifest: {path}: cannot read: {e}") from e

	keep = []
	for i, h in enumerate(header):
		if (h or "").strip():
			keep.append(True)
			continue
		col_nonempty = any(
			(row[i] if i < len(row) else "").strip() for row in data_rows
		)
		keep.append(col_nonempty)
	header_visible = [h for h, k in zip(header, keep) if k]
	return header_visible, len(data_rows)


# Per-group spec for the generated combined tables. The leading underscore
# in the filename makes them sort to the top of their section in the index.
# `columns` is either None (union of every column found in the source files,
# in first-appearance order) or an explicit list (used verbatim). A synthetic
# `source` column is always prepended.
COMBINED_BASENAME = "_all.csv"
COMBINED_SPEC: dict[str, dict] = {
	"variables": {
		"display": "all variables (combined)",
		"columns": None,
	},
	"values": {
		# The values_*.csv files have very heterogeneous schemas, so a union
		# would be mostly empty. Restrict to the columns useful for an
		# "everything in one place" search view.
		"display": "all values (combined)",
		"columns": ["name", "description"],
	},
}


def _entry(site: str, group: str, rel: str) -> dict:
	header, n = _info(os.path.join(site, rel))
	base = os.path.splitext(os.path.basename(rel))[0]
	prefix = group + "_"
	name = base[len(prefix):] if base.startswith(prefix) else base
	entry = {
		"group": group,
		"name": name,
		"file": rel.replace(os.sep, "/"),
		"rows": n,
		"cols": len(header),
	}
	if entry["file"] == f"{group}/{COMBINED_BASENAME}" and group in COMBINED_SPEC:
		entry["displayName"] = COMBINED_SPEC[group]["display"]
	return entry


def _build_combined(site: str, group: str, columns: list[str] | None) -> None:
	"""Write `<site>/<group>/_all.csv` combining every `<group>_*.csv`.

	The output starts with a synthetic `source` column whose value is the
	source file's short name (e.g. `crop`, `soil`). If `columns` is None,
	all source columns are kept (union in first-appearance order); if it is
	a list, only those columns are kept, in the given order. Source files
	that don't have a requested column leave those cells empty.
	"""
	src_dir = os.path.join(site, group)
	if not os.path.isdir(src_dir):
		return

	prefix = group + "_"
	sources: list[tuple[str, list[str], list[list[str]]]] = []
	for fn in sorted(os.listdir(src_dir)):
		# Skip the file we are about to write, and any non-source files.
		if fn == COMBINED_BASENAME:
			continue
		if not fn.lower().endswith(".csv"):
			continue
		if not fn.startswith(prefix):
			continue
		label = os.path.splitext(fn)[0][len(prefix):]
		path = os.path.join(src_dir, fn)
		try:
			with open(path, newline="", encoding="utf-8") as f:
				reader = csv.reader(f)
				header = [(h or "").lstrip("\ufeff") for h in next(reader, [])]
				rows = [row for row in reader]
		except UnicodeDecodeError as e:
			raise SystemExit(
				f"combine: {path}: not valid UTF-8 at byte {e.start}: "
				f"{e.reason}. Re-save the file as UTF-8 (no BOM)."
			) from e
		sources.append((label, header, rows))

	if not sources:
		return

	if columns is None:
		seen: set[str] = set()
		ordered: list[str] = []
		for _label, header, _rows in sources:
			for h in header:
				if h and h not in seen:
					seen.add(h)
					ordered.append(h)
	else:
		ordered = list(columns)

	out_header = ["source"] + ordered
	out_path = os.path.join(src_dir, COMBINED_BASENAME)
	with open(out_path, "w", newline="", encoding="utf-8") as f:
		w = csv.writer(f)
		w.writerow(out_header)
		for label, header, rows in sources:
			idx_for = {h: i for i, h in enumerate(header) if h}
			for row in rows:
				new_row = [label]
				for col in ordered:
					i = idx_for.get(col)
					new_row.append(row[i] if (i is not None and i < len(row)) else "")
				w.writerow(new_row)


def build(site: str) -> list[dict]:
	for group, spec in COMBINED_SPEC.items():
		_build_combined(site, group, spec["columns"])
	tables: list[dict] = []
	for group in ("variables", "values"):
		d = os.path.join(site, group)
		if os.path.isdir(d):
			for fn in sorted(os.listdir(d)):
				if fn.lower().endswith(".csv"):
					tables.append(_entry(site, group, f"{group}/{fn}"))
	# Also pick up any top-level values_*.csv / variables_*.csv files.
	for fn in sorted(os.listdir(site)):
		if fn.lower().endswith(".csv") and (fn.startswith("values_") or fn.startswith("variables_")):
			group = "values" if fn.startswith("values_") else "variables"
			if not any(t["file"] == fn for t in tables):
				tables.append(_entry(site, group, fn))
	tables.sort(key=lambda t: (t["group"], t["name"]))
	return tables


def main(argv: list[str]) -> int:
	site = argv[1] if len(argv) > 1 else "_site"
	if not os.path.isdir(site):
		print(f"manifest: site root '{site}' does not exist", file=sys.stderr)
		return 1
	tables = build(site)
	out = os.path.join(site, "tables.json")
	with open(out, "w", encoding="utf-8") as f:
		json.dump(tables, f, indent=2)
		f.write("\n")
	print(f"manifest: wrote {len(tables)} table(s) to {out}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main(sys.argv))
