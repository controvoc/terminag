(function () {
	"use strict";

	const cfg = window.SITE_CONFIG || {};
	const repoUrl = cfg.repo ? `https://github.com/${cfg.repo}` : null;
	const rawBase = cfg.repo ? `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch || "main"}` : null;

	async function fetchTables() {
		const r = await fetch("tables.json", { cache: "no-cache" });
		if (!r.ok) throw new Error("cannot load tables.json (HTTP " + r.status + ")");
		return r.json();
	}

	function cardHTML(t) {
		const dims = `${t.rows.toLocaleString()} row${t.rows === 1 ? "" : "s"} \u00b7 ${t.cols} column${t.cols === 1 ? "" : "s"}`;
		const label = t.displayName || t.name;
		return `
			<a class="card" href="table.html?f=${encodeURIComponent(t.file)}">
				<h3>${escapeHtml(label)}</h3>
				<p>${dims}</p>
			</a>`;
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({
			"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
		}[c]));
	}

	async function renderIndex() {
		let tables;
		try {
			tables = await fetchTables();
		} catch (e) {
			document.querySelectorAll(".cards").forEach(h => {
				h.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
			});
			return;
		}

		document.querySelectorAll(".cards").forEach(host => {
			const group = host.dataset.group;
			const list = tables
				.filter(t => t.group === group)
				.sort((a, b) => a.name.localeCompare(b.name));
			host.innerHTML = list.length
				? list.map(cardHTML).join("")
				: '<p class="empty">No tables in this group yet.</p>';
		});

		const filter = document.getElementById("filter");
		if (filter) {
			filter.addEventListener("input", () => {
				const q = filter.value.trim().toLowerCase();
				document.querySelectorAll("section").forEach(sec => {
					let visible = 0;
					sec.querySelectorAll(".card").forEach(c => {
						const name = c.querySelector("h3").textContent.toLowerCase();
						const show = !q || name.includes(q);
						c.style.display = show ? "" : "none";
						if (show) visible++;
					});
					sec.style.display = q && visible === 0 ? "none" : "";
				});
			});
		}

		const link = document.getElementById("repo-link");
		if (link && repoUrl) link.href = repoUrl;
	}

	async function renderTable() {
		const params = new URLSearchParams(location.search);
		const file = params.get("f");
		const host = document.getElementById("table-host");
		const crumb = document.getElementById("crumb");
		const subtitle = document.getElementById("subtitle");

		if (!file) {
			host.innerHTML = '<p class="error">Missing <code>f</code> URL parameter.</p>';
			return;
		}
		// Defensive: avoid escaping out of the site root.
		if (file.includes("..") || file.startsWith("/")) {
			host.innerHTML = '<p class="error">Invalid file path.</p>';
			return;
		}

		// Crumb defaults to the file path; refined to displayName once the
		// manifest is available below.
		crumb.textContent = file;
		document.title = `terminag — ${file}`;

		const raw = document.getElementById("raw-link");
		if (rawBase) raw.href = `${rawBase}/${file}`; else raw.style.display = "none";

		// Manifest is used for both the subtitle and the vocabulary -> values-
		// table linking; failure is non-fatal (table still renders).
		let manifest = [];
		try { manifest = await fetchTables(); } catch (_) { /* optional */ }

		const meta = manifest.find(t => t.file === file);
		if (meta) {
			subtitle.textContent = `${meta.rows.toLocaleString()} rows \u00b7 ${meta.cols} columns`;
			const label = meta.displayName || meta.name;
			crumb.textContent = label;
			document.title = `terminag — ${label}`;
		}

		// Map lower-cased values-table names -> file path, used to resolve
		// `vocabulary` cells in variables tables into hyperlinks.
		const valuesByName = new Map();
		for (const t of manifest) {
			if (t.group === "values") valuesByName.set(t.name.toLowerCase(), t.file);
		}

		let csvText;
		try {
			const r = await fetch(file, { cache: "no-cache" });
			if (!r.ok) throw new Error("HTTP " + r.status);
			csvText = await r.text();
		} catch (e) {
			host.innerHTML = `<p class="error">Could not load <code>${escapeHtml(file)}</code>: ${escapeHtml(e.message)}</p>`;
			return;
		}

		const parsed = Papa.parse(csvText.replace(/^\uFEFF/, "").trim(), {
			header: false,
			skipEmptyLines: true
		});
		if (!parsed.data || parsed.data.length < 1) {
			host.innerHTML = '<p class="error">Empty file.</p>';
			return;
		}

		let headers = parsed.data[0].map(h => String(h || ""));
		let rows = parsed.data.slice(1).map(row => {
			// pad or trim rows so they match header length (avoids Grid.js complaints)
			if (row.length < headers.length) {
				return row.concat(new Array(headers.length - row.length).fill(""));
			}
			return row.slice(0, headers.length);
		});

		({ headers, rows } = dropEmptyColumns(headers, rows));
		({ headers, rows } = reorderForVariables(file, headers, rows));
		const colKeys = headers.map(h => String(h).trim().toLowerCase());
		const vocabIdx = colKeys.indexOf("vocabulary");

		host.innerHTML = "";
		const initialPageSize = readPageSize();
		applyPageSizeSelect(initialPageSize);
		const grid = new gridjs.Grid({
			columns: headers.map((h, idx) => {
				const key = colKeys[idx];
				const col = {
					name: h,
					sort: true,
					// Tag each cell with the column name so CSS can size /
					// wrap columns by semantic key rather than by position.
					attributes: () => ({ "data-col": key })
				};
				if (idx === vocabIdx) {
					col.formatter = (cell) => vocabularyCell(cell, valuesByName);
				}
				return col;
			}),
			data: rows,
			search: { enabled: true },
			sort: true,
			pagination: paginationConfig(initialPageSize, rows.length),
			resizable: true,
			fixedHeader: false,
			width: "100%",
			language: {
				search: { placeholder: "Search this table…" }
			}
		}).render(host);

		const sizeSel = document.getElementById("page-size");
		if (sizeSel) {
			sizeSel.addEventListener("change", () => {
				const val = sizeSel.value;
				writePageSize(val);
				grid.updateConfig({
					pagination: paginationConfig(val, rows.length)
				}).forceRender();
			});
		}
	}

	// Pagination defaults: 100 rows / page, persisted in localStorage.
	const PAGE_SIZE_KEY = "terminag.pageSize";
	const DEFAULT_PAGE_SIZE = "100";

	function readPageSize() {
		try {
			const v = localStorage.getItem(PAGE_SIZE_KEY);
			if (v) return v;
		} catch (_) { /* private mode etc. */ }
		return DEFAULT_PAGE_SIZE;
	}

	function writePageSize(v) {
		try { localStorage.setItem(PAGE_SIZE_KEY, String(v)); } catch (_) {}
	}

	function applyPageSizeSelect(v) {
		const sel = document.getElementById("page-size");
		if (!sel) return;
		const known = Array.from(sel.options).some(o => o.value === String(v));
		sel.value = known ? String(v) : DEFAULT_PAGE_SIZE;
	}

	function paginationConfig(size, totalRows) {
		// `size` is "all" or a numeric string. Show all rows by setting the
		// limit to the row count so Grid.js produces a single page.
		if (String(size).toLowerCase() === "all") {
			return { enabled: true, limit: Math.max(totalRows, 1), summary: true };
		}
		const n = parseInt(size, 10);
		if (!isFinite(n) || n <= 0) {
			return { enabled: true, limit: parseInt(DEFAULT_PAGE_SIZE, 10), summary: true };
		}
		return { enabled: true, limit: n, summary: true };
	}

	// Render a `vocabulary` cell as a hyperlink to the matching values table
	// when it exists, otherwise as plain text. Supports semicolon-separated
	// lists, e.g. "crop; country", linking each part independently.
	function vocabularyCell(cell, valuesByName) {
		if (cell == null) return "";
		const text = String(cell).trim();
		if (!text) return "";
		const parts = text.split(/\s*;\s*/);
		const rendered = parts.map(part => {
			const file = valuesByName.get(part.toLowerCase());
			if (!file) return escapeHtml(part);
			const href = `table.html?f=${encodeURIComponent(file)}`;
			return `<a href="${href}">${escapeHtml(part)}</a>`;
		});
		return gridjs.html(rendered.join("; "));
	}

	// Drop any column whose header is blank/whitespace and whose every data
	// cell is blank/whitespace. Catches the "phantom" trailing column that
	// CSV parsers report for files with trailing commas (e.g. `name,` ).
	function dropEmptyColumns(headers, rows) {
		const keep = headers.map((h, i) => {
			const headerEmpty = !String(h || "").trim();
			if (!headerEmpty) return true;
			return rows.some(r => String(r[i] ?? "").trim() !== "");
		});
		if (keep.every(Boolean)) return { headers, rows };
		return {
			headers: headers.filter((_, i) => keep[i]),
			rows: rows.map(r => r.filter((_, i) => keep[i]))
		};
	}

	// For "variables" tables, push the most-read columns to the front
	// (name, type, unit, description, vocabulary) and keep the rest in the
	// original CSV order. No-op for any other file.
	function reorderForVariables(file, headers, rows) {
		const isVariables =
			file.startsWith("variables/") || file.startsWith("variables_");
		if (!isVariables) return { headers, rows };
		const preferred = ["source", "name", "type", "unit", "description", "vocabulary"];
		const lower = headers.map(h => String(h).trim().toLowerCase());
		const order = [];
		for (const p of preferred) {
			const i = lower.indexOf(p);
			if (i !== -1 && !order.includes(i)) order.push(i);
		}
		for (let i = 0; i < headers.length; i++) {
			if (!order.includes(i)) order.push(i);
		}
		return {
			headers: order.map(i => headers[i]),
			rows: rows.map(r => order.map(i => r[i]))
		};
	}

	window.terminag = { renderIndex, renderTable };
})();
