#!/usr/bin/env python3
"""Compare R, JavaScript, and golden checker outputs for terminag fixtures.

Usage:
    python3 compare_checker.py [fixtures_dir]

Exit code 0 when all outputs match; 1 on mismatch or missing files.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys


def _norm_issues(issues: list[dict]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for item in issues:
        out.append((str(item.get("check", "")), str(item.get("msg", ""))))
    return sorted(out)


def _load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _compare(name: str, a: dict, b: dict) -> list[str]:
    errors: list[str] = []
    ids = sorted(set(a.keys()) | set(b.keys()))
    for case_id in ids:
        if case_id not in a:
            errors.append(f"{name}: case '{case_id}' missing in first result")
            continue
        if case_id not in b:
            errors.append(f"{name}: case '{case_id}' missing in second result")
            continue
        ai = _norm_issues(a[case_id])
        bi = _norm_issues(b[case_id])
        if ai != bi:
            errors.append(f"{name}: mismatch for case '{case_id}'")
            only_a = [x for x in ai if x not in bi]
            only_b = [x for x in bi if x not in ai]
            for check, msg in only_a[:5]:
                errors.append(f"  only in A: [{check}] {msg}")
            for check, msg in only_b[:5]:
                errors.append(f"  only in B: [{check}] {msg}")
            if len(only_a) > 5 or len(only_b) > 5:
                errors.append("  ...")
    return errors


def main() -> int:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    argv = sys.argv[1:]
    update_golden = "--update-golden" in argv
    argv = [a for a in argv if a != "--update-golden"]
    fixtures_dir = os.path.abspath(argv[0] if argv else script_dir)
    terminag_root = os.path.normpath(os.path.join(fixtures_dir, "..", "..", ".."))
    expected_dir = os.path.join(fixtures_dir, "expected")

    r_out = os.path.join(fixtures_dir, "r_results.json")
    js_out = os.path.join(fixtures_dir, "js_results.json")

    rscript = os.environ.get("RSCRIPT", "Rscript")
    node = os.environ.get("NODE", "node")

    subprocess.run(
        [rscript, os.path.join(fixtures_dir, "run_checker_r.R"), fixtures_dir, r_out],
        check=True,
        cwd=fixtures_dir,
    )
    r_results = _load_json(r_out)

    if update_golden:
        os.makedirs(expected_dir, exist_ok=True)
        for case_id, issues in sorted(r_results.items()):
            path = os.path.join(expected_dir, f"{case_id}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(issues, f, indent=2, ensure_ascii=False)
                f.write("\n")
        print(f"Updated golden files in {expected_dir} ({len(r_results)} cases).")
        return 0

    subprocess.run(
        [node, os.path.join(fixtures_dir, "run_checker_js.cjs"), fixtures_dir, js_out],
        check=True,
        cwd=fixtures_dir,
    )
    js_results = _load_json(js_out)

    errors = _compare("R vs JS", r_results, js_results)

    if os.path.isdir(expected_dir):
        for case_file in sorted(os.listdir(expected_dir)):
            if not case_file.endswith(".json"):
                continue
            case_id = case_file[:-5]
            expected_path = os.path.join(expected_dir, case_file)
            expected = {case_id: _load_json(expected_path)}
            subset_r = {case_id: r_results.get(case_id, [])}
            errors.extend(_compare(f"R vs golden ({case_id})", subset_r, expected))

    if errors:
        print("Checker golden test FAILED:")
        for line in errors:
            print(line)
        return 1

    print(f"Checker golden test passed ({len(r_results)} cases, R matches JS and golden).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
