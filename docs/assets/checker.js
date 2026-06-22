/* Carob / terminag in-browser term checker (mirrors carobiner::check_terms, nogeo). */
(function (global) {
	"use strict";

	function push(issues, check, msg) {
		issues.push({ check, msg });
	}

	function isMissing(v) {
		if (v === null || v === undefined) return true;
		if (typeof v === "number" && Number.isNaN(v)) return true;
		if (typeof v === "string" && v.trim() === "") return true;
		return false;
	}

	function parseCSV(text) {
		const rows = [];
		let row = [];
		let field = "";
		let i = 0;
		const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		let inQuotes = false;
		while (i < s.length) {
			const c = s[i];
			if (inQuotes) {
				if (c === '"') {
					if (s[i + 1] === '"') {
						field += '"';
						i += 2;
						continue;
					}
					inQuotes = false;
					i++;
					continue;
				}
				field += c;
				i++;
				continue;
			}
			if (c === '"') {
				inQuotes = true;
				i++;
				continue;
			}
			if (c === ",") {
				row.push(field);
				field = "";
				i++;
				continue;
			}
			if (c === "\n") {
				row.push(field);
				rows.push(row);
				row = [];
				field = "";
				i++;
				continue;
			}
			field += c;
			i++;
		}
		row.push(field);
		if (row.length > 1 || row[0] !== "" || rows.length === 0) rows.push(row);
		if (rows.length === 0) return { columns: [], rows: [] };
		const columns = rows[0].map(h => h.trim().replace(/^\ufeff/, ""));
		const data = [];
		for (let r = 1; r < rows.length; r++) {
			const cells = rows[r];
			if (cells.every(c => c === "")) continue;
			const obj = {};
			for (let c = 0; c < columns.length; c++) {
				obj[columns[c]] = cells[c] !== undefined ? cells[c] : "";
			}
			data.push(obj);
		}
		return { columns, rows: data };
	}

	function tableFromRows(rows) {
		if (!rows || rows.length === 0) return { columns: [], rows: [] };
		const columns = Object.keys(rows[0]);
		return { columns, rows };
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

	function filterVariables(vocab, opts = {}) {
		let vars = vocab.variables || [];
		if (opts.include) {
			const inc = new Set(opts.include);
			vars = vars.filter(v => inc.has(v.group));
		}
		if (opts.exclude) {
			const exc = new Set(opts.exclude);
			vars = vars.filter(v => !exc.has(v.group));
		}
		return vars;
	}

	function termByName(trms, name) {
		return trms.find(t => t.name === name);
	}

	function checkKnown(columns, trms, issues) {
		const known = new Set(trms.map(t => t.name));
		const bad = columns.filter(c => !known.has(c));
		if (bad.length) push(issues, "unknown variables", bad.join(", "));
	}

	function checkRequired(columns, trms, issues, typeLabel) {
		const req = trms.filter(t => t.required === "yes").map(t => t.name);
		const missing = req.filter(n => !columns.includes(n));
		if (missing.length) {
			const prefix = typeLabel ? `${typeLabel}: ` : "";
			push(issues, "missing variables", prefix + missing.join(", "));
		}
	}

	function checkDups(columns, issues) {
		const counts = {};
		for (const c of columns) counts[c] = (counts[c] || 0) + 1;
		const dups = Object.keys(counts).filter(c => counts[c] > 1);
		if (dups.length) push(issues, "duplicate variables", dups.join(", "));
	}

	function checkVariables(table, trms, issues, required) {
		checkKnown(table.columns, trms, issues);
		if (required) checkRequired(table.columns, trms, issues, "");
		checkDups(table.columns, issues);
	}

	function checkMissingValues(table, trms, issues) {
		let nms = trms.filter(t => t.NAok === "no").map(t => t.name);
		nms = nms.filter(n => table.columns.includes(n));
		if (nms.length === 0) return;
		const allNa = [];
		const anyNa = [];
		for (const n of nms) {
			const vals = colValues(table, n);
			const na = vals.map(isMissing);
			if (na.every(Boolean)) allNa.push(n);
			else if (na.some(Boolean)) anyNa.push(n);
		}
		if (allNa.length) push(issues, "all NA", allNa.join(", "));
		if (anyNa.length) push(issues, "NA values", anyNa.join(", "));
	}

	function checkEmpty(table, issues) {
		const badTrim = [];
		const badEmpty = [];
		for (const col of table.columns) {
			const vals = colValues(table, col);
			const inferred = inferType(vals);
			if (inferred !== "character") continue;
			for (const v of vals) {
				if (isMissing(v)) continue;
				const raw = String(v);
				const trimmed = raw.trim();
				if (trimmed === "") badEmpty.push(col);
				else if (trimmed.length < raw.length) badTrim.push(col);
			}
		}
		if (badEmpty.length) {
			const u = [...new Set(badEmpty)];
			push(issues, "empty character values", u.join(", "));
		}
		if (badTrim.length) {
			const u = [...new Set(badTrim)];
			push(issues, "untrimmed characters", u.join(", "));
		}
	}

	function checkRanges(table, trms, issues) {
		const numeric = trms.filter(t => t.type === "numeric");
		const bad = [];
		for (const tr of numeric) {
			if (!table.columns.includes(tr.name)) continue;
			const min = tr.valid_min === "" ? null : Number(tr.valid_min);
			const max = tr.valid_max === "" ? null : Number(tr.valid_max);
			if (min === null && max === null) continue;
			const vals = colValues(table, tr.name)
				.filter(v => !isMissing(v))
				.map(Number)
				.filter(n => !Number.isNaN(n));
			if (vals.length === 0) continue;
			const out = vals.some(n => (min !== null && n < min) || (max !== null && n > max));
			if (out) {
				const lo = Math.min(...vals);
				const hi = Math.max(...vals);
				bad.push(`${tr.name} (${lo}, ${hi})`);
			}
		}
		if (bad.length) push(issues, "out of bounds", bad.join(", "));
	}

	function checkTypeRange(table, trms, issues) {
		let cols = table.columns.filter(c => termByName(trms, c));
		if (cols.length === 0) return;
		const skipAllNa = cols.filter(c =>
			colValues(table, c).every(isMissing)
		);
		cols = cols.filter(c => !skipAllNa.includes(c));
		if (cols.length === 0) return;
		const badTypes = [];
		const keepTrms = [];
		for (const col of cols) {
			const tr = termByName(trms, col);
			if (!tr || !tr.type) continue;
			let actual = inferType(colValues(table, col));
			let expected = tr.type;
			if (actual === "character" && expected === "date") expected = "character";
			if (actual === "integer" && expected === "numeric") actual = "numeric";
			if (actual !== expected) {
				badTypes.push(`${col} (${actual}, not ${expected})`);
			} else {
				keepTrms.push(tr);
			}
		}
		if (badTypes.length) push(issues, "bad datatype", badTypes.join(", "));
		checkRanges(table, keepTrms, issues);
	}

	function checkAccepted(table, trms, vocab, issues) {
		const withVoc = trms.filter(t => t.vocabulary);
		for (const tr of withVoc) {
			if (!table.columns.includes(tr.name)) continue;
			const vocKey = tr.vocabulary;
			const accepted = vocab.values[vocKey];
			if (!accepted) continue;
			const acceptedNames = new Set(
				Array.isArray(accepted)
					? accepted.map(a => (typeof a === "string" ? a : a.name))
					: []
			);
			let provided = uniqueNonMissing(colValues(table, tr.name));
			if (tr.required !== "yes") {
				provided = provided.filter(v => !isMissing(v));
			}
			if (tr.multiple_allowed === "yes") {
				provided = [...new Set(
					provided.flatMap(v => String(v).split(/;|;\s/))
				)];
			}
			if (vocKey === "crop") {
				provided = [...new Set(
					provided.flatMap(v => String(v).includes("_")
						? String(v).split("_") : [String(v)])
				)];
			}
			if (tr.NAok === "yes") {
				provided = provided.filter(v => !isMissing(v));
			}
			const bad = provided.filter(p => !acceptedNames.has(p));
			if (bad.length) {
				push(issues, "invalid terms", `${tr.name}: ${bad.sort().join(", ")}`);
			}
		}
	}

	function checkValues(table, trms, vocab, issues) {
		checkMissingValues(table, trms, issues);
		checkEmpty(table, issues);
		checkTypeRange(table, trms, issues);
		checkAccepted(table, trms, vocab, issues);
	}

	function checkDate(table, name, trms, issues) {
		if (!table.columns.includes(name)) return;
		let vals = colValues(table, name).filter(v => !isMissing(v));
		if (vals.length === 0) return;
		const tr = termByName(trms, name);
		if (vals.some(v => String(v).includes(";"))) {
			if (tr && tr.multiple_allowed !== "yes") {
				push(issues, "date", `multiple dates in: ${name}`);
			}
			vals = vals.flatMap(v => String(v).split(/;|;\s/));
		}
		const today = new Date();
		const thisYear = today.getFullYear();
		const todayStr = today.toISOString().slice(0, 10);
		for (const raw of vals) {
			const x = String(raw).trim();
			const n = x.length;
			if (![4, 7, 10].includes(n)) {
				push(issues, "invalid date format", name);
				continue;
			}
			if (n === 10) {
				if (x.includes("/")) push(issues, "date", `found '/' signs in date(s) in: ${name}`);
				const d = Date.parse(x);
				if (Number.isNaN(d)) push(issues, "date", `invalid date(s) in: ${name}`);
				if (x < "1950-01-01") push(issues, "date", `date(s) before 1950 in: ${name}`);
				if (x > todayStr) push(issues, "date", `future date(s) in: ${name}`);
				const m = Number(x.slice(5, 7));
				if (m < 1 || m > 12) push(issues, "date", `months not between 1 and 12): ${name}`);
			}
			if (n === 7) {
				if (x[4] !== "-") push(issues, "date", `bad date(s) in: ${name}`);
				const y = Number(x.slice(0, 4));
				if (y < 1960) push(issues, "date", `date(s) before 1960 in: ${name}`);
				if (y > thisYear) push(issues, "date", `date(s) after ${thisYear} in: ${name}`);
				const m = Number(x.slice(5, 7));
				if (m < 1 || m > 12) push(issues, "date", `months not between 1 and 12): ${name}`);
			}
			if (n === 4) {
				const y = Number(x);
				if (y < 1960) push(issues, "date", `date(s) before 1960 in: ${name}`);
				if (y > thisYear) push(issues, "date", `date(s) after ${thisYear} in: ${name}`);
			}
		}
	}

	function checkCombined(table, trms, vocab, issues, required) {
		checkVariables(table, trms, issues, required);
		checkValues(table, trms, vocab, issues);
		const dateCols = table.columns.filter(c => c.includes("_date") || c.endsWith("date"));
		for (const d of dateCols) checkDate(table, d, trms, issues);
	}

	function parseYmd(s) {
		const x = String(s).trim();
		if (x.length !== 10) return null;
		const d = Date.parse(x);
		return Number.isNaN(d) ? null : new Date(x);
	}

	function checkDatespan(table, issues) {
		if (!table.columns.includes("planting_date") || !table.columns.includes("harvest_date")) return;
		let shortCount = 0;
		let longCount = 0;
		for (const row of table.rows) {
			const s = parseYmd(row.planting_date);
			const e = parseYmd(row.harvest_date);
			if (!s || !e) continue;
			const days = (e - s) / (86400000);
			if (days < 45) shortCount++;
			if (days > 366) longCount++;
		}
		if (shortCount) push(issues, "datespan",
			`${shortCount} records with harvest_date within 45 days of planting_date`);
		if (longCount) push(issues, "datespan",
			`${longCount} harvest_date more than 366 days after planting_date`);
	}

	function checkConsistency(table, issues) {
		if (table.columns.includes("crop_price")) {
			if (!table.columns.includes("currency")) {
				push(issues, "no currency", "crop_price variable used, but currency variable missing");
			} else {
				const bad = table.rows.some(r =>
					isMissing(r.currency) && !isMissing(r.crop_price)
				);
				if (bad) push(issues, "currency missing", "crop_price values without currency values found");
			}
		}
		if (table.columns.includes("yield_moisture")) {
			const allNa = colValues(table, "yield_moisture").every(isMissing);
			if (allNa && !table.columns.includes("yield_isfresh")) {
				push(issues, "yield_isfresh",
					"yield_isfresh must be set to TRUE or NA if yield_moisture is NA");
			}
		}
	}

	function checkCropYield(table, vocab, issues) {
		if (!table.columns.includes("crop") || !table.columns.includes("yield")) return;
		if (colValues(table, "yield").every(isMissing)) return;
		const pairs = table.rows
			.filter(r => !isMissing(r.crop) && !isMissing(r.yield))
			.map(r => ({ crop: String(r.crop), yield: Number(r.yield) }));
		const maxByCrop = {};
		for (const p of pairs) {
			if (Number.isNaN(p.yield)) continue;
			maxByCrop[p.crop] = Math.max(maxByCrop[p.crop] || 0, p.yield);
		}
		const low = Object.keys(maxByCrop).filter(c => maxByCrop[c] < 100);
		if (low.length) push(issues, "low yield (tons not kg?)", low.join(", "));
		const cropVoc = vocab.values.crop || [];
		const cropMap = new Map(cropVoc.map(c => [c.name, c.max_yield]));
		const high = [];
		for (const [crop, y] of Object.entries(maxByCrop)) {
			const mx = cropMap.get(crop);
			if (mx !== undefined && y > mx) high.push(`${crop}: ${y}`);
		}
		if (high.length) push(issues, "high crop yield", high.join(", "));
	}

	function checkCaps(table, issues) {
		const locvars = ["country", "adm1", "adm2", "adm3", "adm4", "adm5", "site", "location"]
			.filter(v => table.columns.includes(v));
		for (const v of locvars) {
			const m = uniqueNonMissing(colValues(table, v))
				.filter(x => String(x).length >= 5);
			const upper = m.filter(x => String(x) === String(x).toUpperCase());
			if (upper.length > 0.1 * m.length) push(issues, "all uppercase", v);
		}
		if (table.columns.includes("site") && !table.columns.includes("location")) {
			push(issues, "location/site",
				"variable 'site' is not allowed if variable 'location' is absent");
		}
	}

	function findDuplicates(table, issues) {
		const keys = table.rows.map(r => JSON.stringify(r));
		if (keys.length !== new Set(keys).size) {
			push(issues, "duplicates", "duplicate records detected");
		}
	}

	function checkRecords(table, vocab, issues, opts) {
		const trms = filterVariables(vocab, { exclude: ["metadata", "carob-metadata"] });
		checkCombined(table, trms, vocab, issues, true);
		checkDatespan(table, issues);
		checkConsistency(table, issues);
		checkCropYield(table, vocab, issues);
		if (!opts.nogeo && table.columns.includes("longitude") && table.columns.includes("latitude")) {
			push(issues, "location",
				"geo checks (land, country match) are not available in the browser checker; use carobiner::check_terms in R or skip with check='nogeo'");
		}
		if (table.columns.includes("record_id")) {
			const ids = colValues(table, "record_id").filter(v => !isMissing(v));
			if (ids.length !== new Set(ids).size) {
				push(issues, "duplicates", "duplicates in record_id");
			}
		}
		checkCaps(table, issues);
	}

	function checkMetadata(meta, vocab, issues) {
		const trms = filterVariables(vocab, { include: ["metadata", "carob-metadata"] });
		const table = tableFromRows([meta]);
		checkCombined(table, trms, vocab, issues, true);
		if (meta.uri && String(meta.uri).includes("http")) {
			push(issues, "uri", "http in uri");
		}
	}

	function checkTreatments(issues, treatment, dataType, varNames, records, type) {
		if (isMissing(treatment)) {
			push(issues, "metadata", `${type} cannot be NA`);
			return;
		}
		let treat = String(treatment).split(";").map(s => s.trim()).filter(Boolean);
		if (treat.includes("none")) {
			if (type === "treatment" && /experiment|trial/i.test(String(dataType || ""))) {
				push(issues, "metadata", "treatment_vars cannot be 'none' for experiments");
				return;
			}
			treat = treat.filter(t => t !== "none");
			if (treat.length === 0) return;
		}
		const missing = treat.filter(t => !varNames.includes(t));
		if (missing.length) {
			push(issues, "metadata",
				`${type} is not a variable in the data: ${missing.join(", ")}`);
		}
		if (type !== "treatment" || !records) return;
		const recCols = records.columns;
		for (const v of treat) {
			if (!recCols.includes(v)) continue;
			const vals = colValues(records, v);
			if (vals.some(isMissing)) {
				push(issues, "metadata", `missing values in treatment variable ${v}`);
			}
			const u = uniqueNonMissing(vals);
			if (u.length < 2) {
				push(issues, "metadata", `no variation in treatment variable ${v}`);
			}
		}
	}

	function checkTerms(opts) {
		const {
			vocab,
			records = null,
			metadata = null,
			group = "",
			check = "all",
		} = opts;
		const issues = [];
		if (check === "none") return issues;
		const nogeo = check === "nogeo" || (Array.isArray(check) && check.includes("nogeo"));
		let recNames = [];
		if (records) recNames = records.columns.slice();
		if (metadata) {
			checkMetadata(metadata, vocab, issues);
			if (!isMissing(metadata.treatment_vars)) {
				checkTreatments(issues, metadata.treatment_vars, metadata.data_type,
					recNames, records, "treatment");
			}
			if (!isMissing(metadata.response_vars)) {
				checkTreatments(issues, metadata.response_vars, metadata.data_type,
					recNames, records, "response");
			}
		}
		if (records) {
			checkRecords(records, vocab, issues, { nogeo });
			findDuplicates(records, issues);
		}
		return issues;
	}

	global.CarobCheck = {
		parseCSV,
		tableFromRows,
		checkTerms,
	};
})(typeof window !== "undefined" ? window : globalThis);
