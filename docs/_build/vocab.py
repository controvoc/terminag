#!/usr/bin/env python3
"""Build `vocab.json` for the in-browser Carob term checker.

Reads `variables/` and `values/` from a assembled site root (same layout as
GitHub Pages) and writes structured JSON consumed by `docs/assets/checker.js`.

Usage:
    python3 docs/_build/vocab.py <site_root>
"""
from __future__ import annotations

import csv
import json
import os
import sys

META_GROUPS = frozenset({"metadata", "carob-metadata"})


def _read_csv(path: str) -> tuple[list[str], list[dict[str, str]]]:
	with open(path, newline="", encoding="utf-8") as f:
		reader = csv.DictReader(f)
		if reader.fieldnames is None:
			return [], []
		header = [h.lstrip("\ufeff") for h in reader.fieldnames]
		rows: list[dict[str, str]] = []
		for row in reader:
			rows.append({k: (v if v is not None else "") for k, v in row.items()})
		return header, rows


def _load_variables(site: str) -> list[dict]:
	out: list[dict] = []
	var_dir = os.path.join(site, "variables")
	if os.path.isdir(var_dir):
		for fn in sorted(os.listdir(var_dir)):
			if not fn.startswith("variables_") or not fn.endswith(".csv"):
				continue
			group = fn[len("variables_"):-4]
			_, rows = _read_csv(os.path.join(var_dir, fn))
			for row in rows:
				name = (row.get("name") or "").strip()
				if not name:
					continue
				out.append({
					"name": name,
					"group": group,
					"type": (row.get("type") or "").strip(),
					"required": (row.get("required") or "").strip(),
					"vocabulary": (row.get("vocabulary") or "").strip(),
					"multiple_allowed": (row.get("multiple_allowed") or "").strip(),
					"valid_min": (row.get("valid_min") or "").strip(),
					"valid_max": (row.get("valid_max") or "").strip(),
					"NAok": (row.get("NAok") or "").strip(),
				})
	for fn in sorted(os.listdir(site)):
		if fn.startswith("variables_") and fn.endswith(".csv"):
			group = fn[len("variables_"):-4]
			_, rows = _read_csv(os.path.join(site, fn))
			for row in rows:
				name = (row.get("name") or "").strip()
				if not name or any(v["name"] == name for v in out):
					continue
				out.append({
					"name": name,
					"group": group,
					"type": (row.get("type") or "").strip(),
					"required": (row.get("required") or "").strip(),
					"vocabulary": (row.get("vocabulary") or "").strip(),
					"multiple_allowed": (row.get("multiple_allowed") or "").strip(),
					"valid_min": (row.get("valid_min") or "").strip(),
					"valid_max": (row.get("valid_max") or "").strip(),
					"NAok": (row.get("NAok") or "").strip(),
				})
	return out


def _load_values(site: str) -> dict:
	out: dict = {}
	val_dir = os.path.join(site, "values")
	paths: list[str] = []
	if os.path.isdir(val_dir):
		for fn in sorted(os.listdir(val_dir)):
			if fn.startswith("values_") and fn.endswith(".csv"):
				paths.append(os.path.join(val_dir, fn))
	for fn in sorted(os.listdir(site)):
		if fn.startswith("values_") and fn.endswith(".csv"):
			paths.append(os.path.join(site, fn))
	seen_keys: set[str] = set()
	for path in paths:
		key = os.path.basename(path)[len("values_"):-4]
		if key in seen_keys:
			continue
		seen_keys.add(key)
		_, rows = _read_csv(path)
		if not rows:
			continue
		if key == "crop":
			crops = []
			for row in rows:
				name = (row.get("name") or "").strip()
				if not name:
					continue
				mx = (row.get("max_yield") or "").strip()
				entry: dict = {"name": name}
				if mx:
					try:
						entry["max_yield"] = float(mx)
					except ValueError:
						pass
				crops.append(entry)
			out[key] = crops
		else:
			col = "name" if "name" in rows[0] else "value"
			if col not in rows[0]:
				col = next(iter(rows[0]))
			vals = sorted({
				(row.get(col) or "").strip()
				for row in rows
				if (row.get(col) or "").strip()
			})
			out[key] = vals
	return out


def build_vocab(site: str) -> dict:
	variables = _load_variables(site)
	return {
		"variables": variables,
		"values": _load_values(site),
		"metaGroups": sorted(META_GROUPS),
	}


def main(argv: list[str]) -> int:
	site = argv[1] if len(argv) > 1 else "_site"
	if not os.path.isdir(site):
		print(f"vocab: site root '{site}' does not exist", file=sys.stderr)
		return 1
	vocab = build_vocab(site)
	out = os.path.join(site, "vocab.json")
	with open(out, "w", encoding="utf-8") as f:
		json.dump(vocab, f, indent=2, ensure_ascii=False)
		f.write("\n")
	print(f"vocab: wrote {len(vocab['variables'])} variables, "
	      f"{len(vocab['values'])} value lists to {out}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main(sys.argv))
