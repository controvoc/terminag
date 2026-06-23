/* Carob-style HTML report for browser checker (mirrors carobiner dataset.Rmd, simplified). */
(function (global) {
	"use strict";

	const MAX_RECORD_ROWS = 2500;

	function isMissing(v) {
		if (v === null || v === undefined) return true;
		if (typeof v === "number" && Number.isNaN(v)) return true;
		if (typeof v === "string" && v.trim() === "") return true;
		return false;
	}

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function uriHref(uri) {
		if (isMissing(uri)) return "";
		const s = String(uri).trim();
		if (/^https?:\/\//i.test(s)) return s;
		if (s.startsWith("doi:")) return "https://doi.org/" + encodeURIComponent(s.slice(4).trim());
		if (s.startsWith("hdl:")) return "https://hdl.handle.net/" + encodeURIComponent(s.slice(4).trim());
		return s;
	}

	function linkifyUri(uri, label) {
		if (isMissing(uri)) return "";
		const href = uriHref(uri);
		const text = label || uri;
		if (href === text || !/^https?:\/\//i.test(href)) return escapeHtml(text);
		return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
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

	function colValues(table, name) {
		return table.rows.map(r => r[name]);
	}

	function getValues(values, label) {
		const u = uniqueNonMissing(values);
		if (u.length === 0) return "";
		if (u.length === 1) return escapeHtml(String(u[0]));
		const sorted = [...u].map(String).sort();
		return `${u.length} ${label} (${escapeHtml(sorted.join(", "))})`;
	}

	function summarizeTreatments(metadata, recordColumns) {
		if (!metadata || isMissing(metadata.treatment_vars)) return { count: 0, text: "" };
		let tvars = String(metadata.treatment_vars)
			.split(";")
			.map(s => s.trim())
			.filter(Boolean);
		tvars = tvars.filter(t => t !== "none" && t !== "longitude" && t !== "latitude");
		tvars = tvars.filter(t => recordColumns.includes(t));
		if (tvars.length === 0) return { count: 0, text: "" };
		const sorted = [...new Set(tvars)].sort();
		return {
			count: sorted.length,
			text: escapeHtml(sorted.join(", ")),
		};
	}

	function summarizeLocations(table) {
		const locvars = ["country", "adm1", "adm2", "adm3", "adm4", "adm5", "location", "site", "longitude", "latitude"]
			.filter(v => table.columns.includes(v));
		if (locvars.length === 0) {
			return { locCount: 0, xyText: "We do not have location variables in these data.", haveXY: false };
		}
		const locRows = [];
		const locKeys = new Set();
		for (const row of table.rows) {
			const key = locvars.map(v => String(row[v] ?? "")).join("\t");
			if (!locKeys.has(key)) {
				locKeys.add(key);
				const obj = {};
				for (const v of locvars) obj[v] = row[v];
				locRows.push(obj);
			}
		}
		let xyText = "";
		let haveXY = false;
		if (table.columns.includes("longitude") && table.columns.includes("latitude")) {
			const xyKeys = new Set();
			let noCoord = 0;
			for (const row of table.rows) {
				if (isMissing(row.longitude) || isMissing(row.latitude)) {
					noCoord++;
					continue;
				}
				xyKeys.add(`${row.longitude}\t${row.latitude}`);
			}
			const xyCount = xyKeys.size;
			xyText = `We have coordinates for ${xyCount} of these locations.`;
			if (noCoord > 0) xyText += ` ${noCoord} records do not have coordinates.`;
			haveXY = xyCount > 0;
		} else {
			xyText = "We do not have coordinates for these locations.";
		}
		return { locCount: locRows.length, xyText, haveXY };
	}

	function locationPopup(row) {
		const parts = [];
		if (!isMissing(row.country)) parts.push(`country: ${escapeHtml(String(row.country))}`);
		if (!isMissing(row.location)) parts.push(`location: ${escapeHtml(String(row.location))}`);
		if (!isMissing(row.site)) parts.push(`site: ${escapeHtml(String(row.site))}`);
		for (let i = 1; i <= 5; i++) {
			const adm = row[`adm${i}`];
			if (!isMissing(adm)) parts.push(`adm${i}: ${escapeHtml(String(adm))}`);
		}
		if (parts.length === 0) {
			parts.push(`${escapeHtml(String(row.longitude))}, ${escapeHtml(String(row.latitude))}`);
		}
		return parts.join("<br>");
	}

	function collectMapPoints(table) {
		if (!table.columns.includes("longitude") || !table.columns.includes("latitude")) {
			return [];
		}
		const byKey = new Map();
		for (const row of table.rows) {
			if (isMissing(row.longitude) || isMissing(row.latitude)) continue;
			const lon = Number(row.longitude);
			const lat = Number(row.latitude);
			if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
			const key = `${lon}\t${lat}`;
			if (!byKey.has(key)) {
				byKey.set(key, { lat, lon, popup: locationPopup(row) });
			}
		}
		return [...byKey.values()];
	}

	const mapInstances = new WeakMap();

	function destroyMap(mapEl) {
		if (!mapEl) return;
		const map = mapInstances.get(mapEl);
		if (map) {
			map.remove();
			mapInstances.delete(mapEl);
		}
	}

	function initMap(mapEl, records) {
		if (!mapEl || typeof global.L === "undefined") return null;
		destroyMap(mapEl);
		const points = collectMapPoints(records);
		if (points.length === 0) {
			mapEl.hidden = true;
			return null;
		}
		mapEl.hidden = false;
		const map = global.L.map(mapEl, { scrollWheelZoom: true });
		const streets = global.L.tileLayer(
			"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
			{
				maxZoom: 19,
				attribution: "&copy; OpenStreetMap contributors",
			}
		);
		const imagery = global.L.tileLayer(
			"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
			{
				maxZoom: 19,
				attribution: "Esri",
			}
		);
		const topo = global.L.tileLayer(
			"https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
			{
				maxZoom: 17,
				attribution: "OpenTopoMap",
			}
		);
		streets.addTo(map);
		const markers = [];
		const markerStyle = {
			radius: 6,
			color: "red",
			weight: 2,
			fillColor: "red",
			fillOpacity: 0.3,
		};
		for (const p of points) {
			const m = global.L.circleMarker([p.lat, p.lon], markerStyle).addTo(map);
			m.bindPopup(p.popup);
			markers.push(m);
		}
		if (points.length === 1) {
			map.setView([points[0].lat, points[0].lon], 10);
		} else {
			const group = global.L.featureGroup(markers);
			map.fitBounds(group.getBounds().pad(0.1));
		}
		global.L.control.layers(
			{
				Streets: streets,
				"Esri.WorldImagery": imagery,
				OpenTopoMap: topo,
			},
			null,
			{ collapsed: false }
		).addTo(map);
		mapInstances.set(mapEl, map);
		setTimeout(() => map.invalidateSize(), 0);
		return map;
	}

	function buildMapSection(haveXY) {
		if (!haveXY) return "";
		return `<div id="carob-report-map" class="report-map" role="region" aria-label="Map of observation locations"></div>`;
	}

	function requiredVariables(vocab) {
		return (vocab.variables || [])
			.filter(v => v.required === "yes" && v.group !== "metadata" && v.group !== "carob-metadata")
			.map(v => v.name);
	}

	function completenessForColumns(table, columnNames) {
		const rows = [];
		for (const name of columnNames) {
			if (!table.columns.includes(name)) continue;
			const vals = colValues(table, name);
			if (vals.length === 0) continue;
			const present = vals.filter(v => !isMissing(v)).length;
			const pct = Math.round((present / vals.length) * 1000) / 10;
			rows.push({ variable: name, completeness: pct });
		}
		rows.sort((a, b) => a.variable.localeCompare(b.variable));
		return rows;
	}

	function formatCompletenessPct(pct) {
		return Number.isInteger(pct) || pct % 1 === 0 ? String(Math.round(pct)) : String(pct);
	}

	function formatRecordNumber(v) {
		const s = String(v).trim();
		const n = Number(s);
		if (Number.isNaN(n)) return s;
		const abs = Math.abs(n);
		let decimals;
		if (abs < 10) decimals = 5;
		else if (abs < 100) decimals = 3;
		else if (abs < 1000) decimals = 1;
		else decimals = 0;
		return n.toLocaleString(undefined, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
	}

	function formatCompletenessInline(rows) {
		const incomplete = rows.filter(r => r.completeness < 100);
		if (incomplete.length === 0) {
			return "<p>All variables are complete (100%).</p>";
		}
		const text = incomplete
			.map(r => `${escapeHtml(r.variable)} (${formatCompletenessPct(r.completeness)}%)`)
			.join(", ");
		return `<p>${text}</p>`;
	}

	function averageCompleteness(rows) {
		if (!rows.length) return null;
		const meanPct = rows.reduce((s, r) => s + r.completeness, 0) / rows.length;
		const roundedPct = Math.round(meanPct * 10) / 10;
		const score = Math.round(roundedPct / 10 * 10) / 10;
		return { meanPct: roundedPct, score };
	}

	function buildAverageSentence(rows) {
		const avg = averageCompleteness(rows);
		if (!avg) return "";
		return `<p class="report-completeness-avg">Average score: ${formatCompletenessPct(avg.score)} out of 10 (${formatCompletenessPct(avg.meanPct)}% of records have a value).</p>`;
	}

	function buildCompletenessIntro() {
		return `<p class="report-completeness-intro">Variable completeness describes how often each column has a value in the uploaded records. For each variable, the percentage is the share of records <em>without</em> a missing value. Variables below 100% are listed below.</p>`;
	}

	function buildCompletenessSubsection(title, rows, emptyMessage) {
		let body;
		if (rows.length === 0) {
			body = `<p>${escapeHtml(emptyMessage)}</p>`;
		} else {
			body = buildAverageSentence(rows) + formatCompletenessInline(rows);
		}
		return `<div class="report-subsection"><h3 class="report-subsection-title">${escapeHtml(title)}</h3>${body}</div>`;
	}

	function buildCompletenessSection(table, vocab) {
		const requiredCols = requiredVariables(vocab).filter(n => table.columns.includes(n));
		const requiredRows = completenessForColumns(table, requiredCols);
		const allRows = completenessForColumns(table, table.columns);
		return [
			buildCompletenessIntro(),
			buildCompletenessSubsection(
				"Required variables",
				requiredRows,
				"No required variables in the uploaded columns."
			),
			buildCompletenessSubsection("All variables", allRows, "No variables in the uploaded data."),
		].join("\n");
	}

	function buildDataTable(columns, rows, caption, formatNumbers = false) {
		if (!columns.length || !rows.length) return "";
		const thead = columns.map(c => `<th>${escapeHtml(c)}</th>`).join("");
		const tbody = rows.map(row => {
			const cells = columns.map(c => {
				const v = row[c];
				let text = "";
				if (!isMissing(v)) {
					text = formatNumbers ? formatRecordNumber(v) : String(v);
				}
				return `<td>${escapeHtml(text)}</td>`;
			}).join("");
			return `<tr>${cells}</tr>`;
		}).join("");
		const cap = caption ? `<caption>${escapeHtml(caption)}</caption>` : "";
		return `<div class="report-scroll-box"><table class="report-table">${cap}<thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
	}

	function previewRecords(table, maxRows) {
		const hide = new Set(["dataset_id", "record_id"]);
		const columns = table.columns.filter(c => !hide.has(c));
		const rows = table.rows.slice(0, maxRows);
		return buildDataTable(columns, rows, "records", true);
	}

	function buildIntro(metadata) {
		if (!metadata) {
			return `<p>This report describes uploaded records checked against the <a href="https://controvoc.github.io/terminag/">terminag</a> vocabulary.</p>`;
		}
		const title = isMissing(metadata.title) ? "untitled dataset" : escapeHtml(metadata.title);
		let parts = [`This report describes data for <em>${title}</em>.`];
		if (!isMissing(metadata.carob_date) && !isMissing(metadata.carob_contributor)) {
			parts.push(
				`These data were standardized on ${escapeHtml(metadata.carob_date)} by ${escapeHtml(metadata.carob_contributor)}.`
			);
		}
		if (!isMissing(metadata.uri)) {
			parts.push(`The ${linkifyUri(metadata.uri, "original data")} are described below.`);
		}
		if (!isMissing(metadata.license)) {
			const lic = escapeHtml(String(metadata.license).replace(/^license\s*/i, "").trim());
			parts.push(
				`License: ${lic} (<a href="https://carob-data.org/licenses.html">details</a>).`
			);
		}
		return `<p>${parts.join(" ")}</p>`;
	}

	function buildCitation(metadata) {
		if (!metadata || isMissing(metadata.data_citation)) return "";
		return `
			<p>This is the full citation of the data set:</p>
			<div class="report-citation"><strong>${escapeHtml(metadata.data_citation)}</strong></div>`;
	}

	function buildPublication(metadata) {
		if (!metadata || isMissing(metadata.publication) || String(metadata.publication).trim() === "none") {
			return "";
		}
		const pub = String(metadata.publication).trim();
		return `<p>You can also consult the accompanying ${linkifyUri(pub, "publication")}.</p>`;
	}

	function buildStatsParagraph(table, metadata, treatments) {
		const crop = table.columns.includes("crop")
			? getValues(colValues(table, "crop"), "crops")
			: "";
		const country = table.columns.includes("country")
			? getValues(colValues(table, "country"), "countries")
			: "";
		let text = `The dataset has ${table.rows.length} records and ${table.columns.length} variables`;
		if (crop) text += ` for ${crop}`;
		if (country) text += ` in ${country}`;
		text += ".";
		if (treatments.count > 0) {
			text += ` The dataset has ${treatments.count} treatment(s): ${treatments.text}.`;
		}
		return `<p>${text}</p>`;
	}

	function buildWarnings(issues) {
		if (!issues || issues.length === 0) {
			return `<p>The data do not emit non-compliance warnings from the vocabulary check.</p>`;
		}
		const rows = issues.map(i => ({ type: i.check, message: i.msg }));
		return `
			<p>The following non-compliance warnings were found:</p>
			${buildDataTable(["type", "message"], rows, "")}`;
	}

	function sectionBlock(num, title, content) {
		if (!content) return "";
		return `<section class="report-section"><h2 class="report-section-title">${num}. ${escapeHtml(title)}</h2>${content}</section>`;
	}

	function buildRecordSampleSectionBlock(table, maxRows = MAX_RECORD_ROWS) {
		return sectionBlock(6, "RECORDS", buildRecordSampleSection(table, maxRows));
	}

	function getBoxplotExport(opts) {
		const bp = global.CarobBoxplot;
		if (!bp || !opts.records?.rows?.length) return null;
		const vocab = opts.vocab || { variables: [] };
		const yVar = opts.boxplotY || bp.defaultY(opts.records, vocab);
		if (!yVar) return null;
		const groupVar = opts.boxplotGroup !== undefined
			? opts.boxplotGroup
			: bp.defaultGroup(opts.records, vocab, yVar);
		return bp.exportConfig(opts.records, vocab, yVar, groupVar || null);
	}

	function buildBoxplotSectionBlock(opts) {
		const ex = getBoxplotExport(opts);
		if (!ex) return "";
		const groupText = ex.groupVar
			? `Grouped by <strong>${escapeHtml(ex.groupVar)}</strong>.`
			: "All records (no grouping).";
		const content = `
			<p>Distribution of <strong>${escapeHtml(ex.yVar)}</strong>. ${groupText}</p>
			<div id="carob-report-boxplot" class="report-boxplot" aria-label="Boxplot chart"></div>`;
		return sectionBlock(5, "BOXPLOT", content);
	}

	function buildSummarySection(metadata, table, treatments) {
		const parts = [
			buildIntro(metadata),
			buildCitation(metadata),
			buildPublication(metadata),
			buildStatsParagraph(table, metadata, treatments),
		].filter(Boolean);
		return parts.join("\n");
	}

	function buildLocationsSection(loc, haveMap) {
		const parts = [
			`<p>The observations were made at ${loc.locCount} locations. ${escapeHtml(loc.xyText)}</p>`,
			buildMapSection(haveMap),
		].filter(Boolean);
		return parts.join("\n");
	}

	function buildRecordSampleSection(table, maxRows) {
		const total = table.rows.length;
		const shown = Math.min(total, maxRows);
		let intro;
		if (total <= maxRows) {
			intro = `<p>All ${shown} records:</p>`;
		} else {
			intro = `<p>Showing ${shown} of ${total} records (maximum included in report):</p>`;
		}
		return `${intro}${previewRecords(table, maxRows)}`;
	}

	/**
	 * Build report body HTML (fragment).
	 * @param {{ records: object, metadata?: object|null, issues?: array, vocab?: object, maxRecordRows?: number }} opts
	 */
	function buildReport(opts) {
		const {
			records,
			metadata = null,
			issues = [],
			vocab = { variables: [] },
		} = opts;
		if (!records || !records.rows || records.rows.length === 0) {
			return "<p>No records to report.</p>";
		}
		const treatments = summarizeTreatments(metadata, records.columns);
		const loc = summarizeLocations(records);

		const sections = [
			sectionBlock(1, "Summary", buildSummarySection(metadata, records, treatments)),
			sectionBlock(2, "Vocabulary check warnings", buildWarnings(issues)),
			sectionBlock(3, "Locations", buildLocationsSection(loc, loc.haveXY)),
			sectionBlock(4, "Variable completeness", buildCompletenessSection(records, vocab)),
		];
		return sections.filter(Boolean).join("\n");
	}

	const REPORT_CSS = `
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1c1c; background: #fafafa; margin: 0; line-height: 1.5; }
main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; background: #fff; border: 1px solid #e5e5e5; }
a { color: #2e7d32; }
.report-title { font-size: 1.6rem; margin: 0 0 1rem; font-weight: 600; }
.report-section { margin: 1.5rem 0; }
.report-section-title { font-size: 1.1rem; margin: 0 0 0.75rem; font-weight: 600; color: #2e7d32; border-bottom: 1px solid #c8e6c9; padding-bottom: 0.35rem; }
.report-subsection { margin: 1rem 0; }
.report-subsection-title { font-size: 0.95rem; margin: 0 0 0.5rem; font-weight: 600; color: #444; }
.report-completeness-intro { margin-bottom: 1rem; }
.report-completeness-avg { margin: 0 0 0.5rem; font-weight: 500; }
.report-citation { padding-left: 2.5rem; margin: 0.5rem 0 1rem; }
.report-scroll-box { border: 1px solid #ddd; overflow: auto; max-height: 400px; max-width: 100%; margin: 0.5rem 0 1rem; }
.report-table { border-collapse: collapse; font-size: 0.88rem; width: max-content; min-width: 100%; }
.report-table caption { caption-side: top; text-align: left; font-weight: 600; padding: 0.5rem 0.65rem 0; }
.report-table th, .report-table td { padding: 0.35rem 0.55rem; border-bottom: 1px solid #e5e5e5; text-align: left; vertical-align: top; white-space: nowrap; }
.report-table thead th { position: sticky; top: 0; background: #fff; font-weight: 600; }
.report-table tbody tr:nth-child(even) { background: #f6f6f6; }
.report-table tbody tr:hover { background: #eef5ee; }
.report-map { height: 480px; width: 100%; max-width: 672px; margin: 0.5rem 0 1rem; border: 1px solid #ddd; border-radius: 4px; }
.report-boxplot { min-height: 420px; width: 100%; margin: 0.5rem 0 1rem; border: 1px solid #ddd; border-radius: 4px; background: #fff; }
footer { text-align: center; padding: 1.5rem; color: #6b6b6b; font-size: 0.85rem; }
`;

	const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
	const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
	const PLOTLY_JS = "https://cdn.plot.ly/plotly-2.35.2.min.js";

	function buildMapInitScript(points) {
		if (!points.length) return "";
		const json = JSON.stringify(points).replace(/</g, "\\u003c");
		return `<script>
(function () {
	var pts = ${json};
	var el = document.getElementById("carob-report-map");
	if (!el || typeof L === "undefined" || !pts.length) return;
	var map = L.map(el, { scrollWheelZoom: true });
	var streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution: "&copy; OpenStreetMap contributors"
	});
	var imagery = L.tileLayer(
		"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		{ maxZoom: 19, attribution: "Esri" }
	);
	var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
		maxZoom: 17,
		attribution: "OpenTopoMap"
	});
	streets.addTo(map);
	var markers = [];
	var style = { radius: 6, color: "red", weight: 2, fillColor: "red", fillOpacity: 0.3 };
	for (var i = 0; i < pts.length; i++) {
		var p = pts[i];
		var m = L.circleMarker([p.lat, p.lon], style).addTo(map);
		m.bindPopup(p.popup);
		markers.push(m);
	}
	if (pts.length === 1) {
		map.setView([pts[0].lat, pts[0].lon], 10);
	} else {
		map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
	}
	L.control.layers({
		Streets: streets,
		"Esri.WorldImagery": imagery,
		OpenTopoMap: topo
	}, null, { collapsed: false }).addTo(map);
	setTimeout(function () { map.invalidateSize(); }, 0);
})();
</script>`;
	}

	function buildBoxplotInitScript(exportConfig) {
		if (!exportConfig) return "";
		const json = JSON.stringify({
			traces: exportConfig.traces,
			layout: exportConfig.layout,
		}).replace(/</g, "\\u003c");
		return `<script>
(function () {
	var spec = ${json};
	var el = document.getElementById("carob-report-boxplot");
	if (!el || typeof Plotly === "undefined" || !spec.traces.length) return;
	Plotly.newPlot(el, spec.traces, spec.layout, { responsive: true, displayModeBar: true });
})();
</script>`;
	}

	function buildReportDocument(opts) {
		const maxRecordRows = opts.maxRecordRows ?? MAX_RECORD_ROWS;
		const boxplotExport = getBoxplotExport(opts);
		const body = buildReport(opts)
			+ buildBoxplotSectionBlock(opts)
			+ buildRecordSampleSectionBlock(opts.records, maxRecordRows);
		const points = collectMapPoints(opts.records || { columns: [], rows: [] });
		const generated = new Date().toISOString().slice(0, 10);
		const mapScript = buildMapInitScript(points);
		const boxplotScript = buildBoxplotInitScript(boxplotExport);
		return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>terminag report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${LEAFLET_CSS}" crossorigin="">
<style>${REPORT_CSS}</style>
</head>
<body>
<main class="report-document">${body}</main>
<footer>Generated by terminag checker on ${generated}.</footer>
<script src="${LEAFLET_JS}" crossorigin=""></script>
<script src="${PLOTLY_JS}" crossorigin=""></script>
${mapScript}
${boxplotScript}
</body>
</html>`;
	}

	global.CarobReport = {
		buildReport,
		buildReportDocument,
		buildRecordSampleSectionBlock,
		collectMapPoints,
		initMap,
		destroyMap,
		MAX_RECORD_ROWS,
	};
})(typeof window !== "undefined" ? window : globalThis);
