/* Interactive boxplots for uploaded Carob records (check.html). */
(function (global) {
	"use strict";

	function isMissing(v) {
		if (v === null || v === undefined) return true;
		if (typeof v === "number" && Number.isNaN(v)) return true;
		if (typeof v === "string" && v.trim() === "") return true;
		return false;
	}

	function colValues(table, name) {
		return table.rows.map(r => r[name]);
	}

	function uniqueNonMissing(values) {
		const out = [];
		const seen = new Set();
		for (const v of values) {
			if (isMissing(v)) continue;
			const key = String(v);
			if (!seen.has(key)) {
				seen.add(key);
				out.push(v);
			}
		}
		return out;
	}

	function inferType(values) {
		const v = values.filter(x => !isMissing(x));
		if (v.length === 0) return "character";
		let numeric = 0;
		let integer = 0;
		let logical = 0;
		for (const x of v) {
			const s = String(x).trim().toLowerCase();
			if (s === "true" || s === "false") {
				logical++;
				continue;
			}
			const n = Number(x);
			if (!Number.isNaN(n)) {
				numeric++;
				if (Number.isInteger(n)) integer++;
			}
		}
		if (logical === v.length) return "logical";
		if (numeric === v.length) return integer === v.length ? "integer" : "numeric";
		return "character";
	}

	function termByName(vocab, name) {
		return (vocab.variables || []).find(t => t.name === name);
	}

	function isFertilizerVariable(name) {
		return /_fertilizer$/i.test(name);
	}

	function inferredNumericColumns(table) {
		return table.columns.filter(col => {
			const vals = colValues(table, col).filter(v => !isMissing(v));
			if (vals.length === 0) return false;
			return vals.every(v => !Number.isNaN(Number(v)));
		});
	}

	function quantitativeColumns(table, vocab) {
		const eligible = new Set();
		const inferred = new Set(inferredNumericColumns(table));
		for (const col of table.columns) {
			const tr = termByName(vocab, col);
			if (tr && (tr.type === "numeric" || tr.type === "integer")) {
				eligible.add(col);
			}
		}
		for (const col of inferred) {
			eligible.add(col);
		}
		return table.columns.filter(col => eligible.has(col));
	}

	function groupingColumns(table, vocab, yVar) {
		const cols = [];
		for (const col of table.columns) {
			if (col === yVar) continue;
			if (isFertilizerVariable(col)) {
				const u = uniqueNonMissing(colValues(table, col));
				if (u.length > 1) cols.push(col);
				continue;
			}
			const tr = termByName(vocab, col);
			const type = tr?.type || inferType(colValues(table, col));
			if (type !== "character" && type !== "logical") continue;
			const u = uniqueNonMissing(colValues(table, col));
			if (u.length < 2) continue;
			cols.push(col);
		}
		return cols;
	}

	function numericValues(table, col) {
		const out = [];
		for (const row of table.rows) {
			if (isMissing(row[col])) continue;
			const n = Number(row[col]);
			if (!Number.isNaN(n)) out.push(n);
		}
		return out;
	}

	function applyBoxHover(trace, groupVar, groupLabel) {
		const stats =
			"upper fence: %{upperfence}<br>" +
			"q3: %{q3}<br>" +
			"median: %{median}<br>" +
			"q1: %{q1}<br>" +
			"lower fence: %{lowerfence}<br>";
		const groupLine =
			groupVar && groupLabel ? `${groupVar}: ${groupLabel}<br>` : "";
		const boxTpl = stats + groupLine + "<extra></extra>";
		const pointTpl =
			(groupVar && groupLabel
				? `y: %{y}<br>${groupVar}: ${groupLabel}<br>`
				: "y: %{y}<br>") + "<extra></extra>";
		trace.hovertemplate_boxes = boxTpl;
		trace.hovertemplate_points = pointTpl;
		return trace;
	}

	function buildTraces(table, yVar, groupVar) {
		if (!groupVar) {
			const y = numericValues(table, yVar);
			if (y.length === 0) return null;
			return [applyBoxHover({
				y,
				type: "box",
				name: "",
				showlegend: false,
				boxpoints: "outliers",
			}, null, null)];
		}
		const groups = new Map();
		for (const row of table.rows) {
			if (isMissing(row[yVar])) continue;
			const n = Number(row[yVar]);
			if (Number.isNaN(n)) continue;
			const g = isMissing(row[groupVar]) ? "(missing)" : String(row[groupVar]).trim();
			if (!groups.has(g)) groups.set(g, []);
			groups.get(g).push(n);
		}
		const entries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		if (entries.length === 0) return null;
		return entries.map(([name, y]) =>
			applyBoxHover({
				y,
				type: "box",
				name,
				boxpoints: "outliers",
			}, groupVar, name)
		);
	}

	function render(plotEl, table, yVar, groupVar) {
		if (!plotEl || typeof global.Plotly === "undefined") return false;
		const traces = buildTraces(table, yVar, groupVar);
		if (!traces) {
			plotEl.innerHTML = "<p class=\"muted\">No numeric values to plot for this variable.</p>";
			return false;
		}
		const layout = {
			margin: { t: 24, r: 24, b: 72, l: 64 },
			yaxis: { title: yVar },
			xaxis: { title: groupVar || "" },
			showlegend: Boolean(groupVar),
			boxmode: "group",
			hovermode: "closest",
		};
		global.Plotly.newPlot(plotEl, traces, layout, { responsive: true, displayModeBar: true });
		return true;
	}

	function fillSelect(select, options, preferred) {
		select.innerHTML = "";
		for (const opt of options) {
			const el = document.createElement("option");
			el.value = opt;
			el.textContent = opt;
			select.appendChild(el);
		}
		if (preferred && options.includes(preferred)) {
			select.value = preferred;
		}
	}

	function setup(opts) {
		const {
			sectionEl,
			ySelectEl,
			groupSelectEl,
			plotEl,
			table,
			vocab,
		} = opts;
		if (!sectionEl || !ySelectEl || !groupSelectEl || !plotEl || !table) return;

		if (typeof global.Plotly !== "undefined") {
			global.Plotly.purge(plotEl);
		}
		plotEl.innerHTML = "";

		const yCols = quantitativeColumns(table, vocab || { variables: [] });
		if (yCols.length === 0) {
			sectionEl.hidden = true;
			return;
		}

		const preferredY = yCols.includes("yield") ? "yield" : yCols[0];
		fillSelect(ySelectEl, yCols, preferredY);

		function refreshGroupOptions() {
			const yVar = ySelectEl.value;
			const gCols = groupingColumns(table, vocab || { variables: [] }, yVar);
			const prev = groupSelectEl.value;
			groupSelectEl.innerHTML = "";
			const none = document.createElement("option");
			none.value = "";
			none.textContent = "None (all records)";
			groupSelectEl.appendChild(none);
			for (const col of gCols) {
				const el = document.createElement("option");
				el.value = col;
				el.textContent = col;
				groupSelectEl.appendChild(el);
			}
			if (prev && gCols.includes(prev)) {
				groupSelectEl.value = prev;
			} else if (gCols.includes("treatment")) {
				groupSelectEl.value = "treatment";
			}
		}

		function draw() {
			plotEl.innerHTML = "";
			render(plotEl, table, ySelectEl.value, groupSelectEl.value || null);
		}

		refreshGroupOptions();
		draw();

		ySelectEl.onchange = () => {
			refreshGroupOptions();
			draw();
		};
		groupSelectEl.onchange = draw;

		sectionEl.hidden = false;
	}

	function reset(sectionEl, plotEl) {
		if (sectionEl) sectionEl.hidden = true;
		if (plotEl && typeof global.Plotly !== "undefined") {
			global.Plotly.purge(plotEl);
			plotEl.innerHTML = "";
		}
	}

	global.CarobBoxplot = {
		quantitativeColumns,
		groupingColumns,
		render,
		setup,
		reset,
	};
})(typeof window !== "undefined" ? window : globalThis);
