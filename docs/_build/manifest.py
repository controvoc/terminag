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


def _entry(site: str, group: str, rel: str) -> dict:
	header, n = _info(os.path.join(site, rel))
	base = os.path.splitext(os.path.basename(rel))[0]
	prefix = group + "_"
	name = base[len(prefix):] if base.startswith(prefix) else base
	return {
		"group": group,
		"name": name,
		"file": rel.replace(os.sep, "/"),
		"rows": n,
		"cols": len(header),
	}


def build(site: str) -> list[dict]:
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
