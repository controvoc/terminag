(function () {
	"use strict";

	const cfg = window.SITE_CONFIG || {};
	const repoUrl = cfg.repo ? `https://github.com/${cfg.repo}` : null;
	const rawBase = cfg.repo ? `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch || "main"}` : null;
	const editBase = cfg.repo ? `${repoUrl}/edit/${cfg.branch || "main"}` : null;

	async function fetchTables() {
		const r = await fetch("tables.json", { cache: "no-cache" });
		if (!r.ok) throw new Error("cannot load tables.json (HTTP " + r.status + ")");
		return r.json();
	}

	function cardHTML(t) {
		const dims = `${t.rows.toLocaleString()} row${t.rows === 1 ? "" : "s"} \u00b7 ${t.cols} column${t.cols === 1 ? "" : "s"}`;
		return `
			<a class="card" href="table.html?f=${encodeURIComponent(t.file)}">
				<h3>${escapeHtml(t.name)}</h3>
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

		crumb.textContent = file;
		document.title = `terminag — ${file}`;

		const raw = document.getElementById("raw-link");
		const edit = document.getElementById("edit-link");
		if (rawBase) raw.href = `${rawBase}/${file}`; else raw.style.display = "none";
		if (editBase) edit.href = `${editBase}/${file}`; else edit.style.display = "none";

		// Pull dims from manifest, if available, for a nice subtitle.
		try {
			const tables = await fetchTables();
			const meta = tables.find(t => t.file === file);
			if (meta) {
				subtitle.textContent = `${meta.rows.toLocaleString()} rows \u00b7 ${meta.cols} columns`;
			}
		} catch (_) { /* manifest is optional */ }

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

		({ headers, rows } = reorderForVariables(file, headers, rows));
		const colKeys = headers.map(h => String(h).trim().toLowerCase());

		host.innerHTML = "";
		new gridjs.Grid({
			columns: headers.map((h, idx) => ({
				name: h,
				sort: true,
				// Tag each cell with the column name so CSS can size / wrap
				// columns by semantic key rather than by position.
				attributes: () => ({ "data-col": colKeys[idx] })
			})),
			data: rows,
			search: { enabled: true },
			sort: true,
			pagination: { enabled: true, limit: 50, summary: true },
			resizable: true,
			fixedHeader: false,
			width: "100%",
			language: {
				search: { placeholder: "Search this table…" }
			}
		}).render(host);
	}

	// For "variables" tables, push the most-read columns to the front
	// (name, type, unit, description, vocabulary) and keep the rest in the
	// original CSV order. No-op for any other file.
	function reorderForVariables(file, headers, rows) {
		const isVariables =
			file.startsWith("variables/") || file.startsWith("variables_");
		if (!isVariables) return { headers, rows };
		const preferred = ["name", "type", "unit", "description", "vocabulary"];
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
