#!/usr/bin/env python3
"""Assemble the terminag site into `_site/` and serve it locally on
http://localhost:8000 for previewing without GitHub Actions.

Usage:
    python3 docs/_build/serve.py [PORT]
"""
from __future__ import annotations

import http.server
import shutil
import socketserver
import sys
import time
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # terminag/
SITE = ROOT / "_site"


def _clean_site(retries: int = 5, delay: float = 0.3) -> None:
	"""Empty the contents of `_site/` (without removing the directory itself).

	Removing only the contents -- rather than the directory -- avoids the
	common Windows `PermissionError: [WinError 32]` you get when *something*
	(Explorer window, indexer, AV, another process's cwd) holds an open
	handle on `_site/` itself. We also retry a few times because such locks
	are usually transient.
	"""
	SITE.mkdir(exist_ok=True)
	last_err: Exception | None = None
	for attempt in range(retries):
		last_err = None
		for entry in list(SITE.iterdir()):
			try:
				if entry.is_dir() and not entry.is_symlink():
					shutil.rmtree(entry)
				else:
					entry.unlink()
			except PermissionError as e:
				last_err = e
		if last_err is None:
			return
		time.sleep(delay)
	hint = (
		"Could not clear all files in _site/. On Windows this usually means "
		"something is holding a handle on it -- a File Explorer window, a "
		"previous `python` process whose working directory is still inside "
		"_site/, or an antivirus / Search indexer scan. Close those (or "
		"`rmdir /S /Q _site`) and try again."
	)
	raise SystemExit(f"serve: {hint}\nLast error: {last_err}")


def assemble() -> None:
	_clean_site()

	for d in ("values", "variables"):
		src = ROOT / d
		if src.is_dir():
			shutil.copytree(src, SITE / d)
	for f in ROOT.glob("values_*.csv"):
		shutil.copy2(f, SITE / f.name)
	for f in ROOT.glob("variables_*.csv"):
		shutil.copy2(f, SITE / f.name)

	docs = ROOT / "docs"
	for entry in docs.iterdir():
		if entry.name == "_build":
			continue
		dest = SITE / entry.name
		if entry.is_dir():
			shutil.copytree(entry, dest)
		else:
			shutil.copy2(entry, dest)

	(SITE / ".nojekyll").touch()
	(SITE / "config.js").write_text(
		'window.SITE_CONFIG = { repo: "carob-data/terminag", branch: "main" };\n',
		encoding="utf-8",
	)

	# Reuse the manifest generator.
	sys.path.insert(0, str(ROOT / "docs" / "_build"))
	import manifest  # type: ignore
	manifest.main(["manifest.py", str(SITE)])
	import vocab  # type: ignore
	vocab.main(["vocab.py", str(SITE)])


def serve(port: int) -> None:
	# Use `directory=` instead of chdir so the server never pins _site/ as
	# its cwd -- a re-run can then rebuild without hitting WinError 32.
	handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
	with socketserver.TCPServer(("", port), handler) as httpd:
		print(f"terminag preview at http://localhost:{port}/  (Ctrl+C to stop)")
		try:
			httpd.serve_forever()
		except KeyboardInterrupt:
			print("\nbye.")


def main(argv: list[str]) -> int:
	port = int(argv[1]) if len(argv) > 1 else 8000
	assemble()
	serve(port)
	return 0


if __name__ == "__main__":
	raise SystemExit(main(sys.argv))
