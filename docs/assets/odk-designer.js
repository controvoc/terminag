/* ODK XLSForm builder from terminag vocabulary. */
(function (global) {
	"use strict";

	const SURVEY_HEADERS = [
		"type", "name", "label", "hint", "required", "appearance",
		"default", "choice_filter", "constraint", "constraint_message",
	];
	const CHOICES_HEADERS = ["list_name", "name", "label"];
	const SETTINGS_HEADERS = ["form_title", "form_id", "version", "default_language", "style"];
	const LOGICAL_LIST = "logical";

	/** Groups omitted from the ODK designer (metadata* and maize). */
	const EXCLUDED_GROUPS = new Set(["metadata", "carob-metadata", "maize"]);

	function isExcludedOdkGroup(group) {
		if (!group) return true;
		if (EXCLUDED_GROUPS.has(group)) return true;
		return group.startsWith("metadata");
	}

	const GROUP_LABELS = {
		survey: "Household & survey",
		crop: "Crop",
		management: "Management",
		location: "Location",
		soil: "Soil",
		weather: "Weather",
		livestock: "Livestock",
		economic: "Economic",
		emission: "Emission",
		general: "General",
	};

	const PRESETS = {
		field_survey: {
			label: "Field survey (household + crop + management + location)",
			groups: ["survey", "crop", "management", "location"],
		},
		experiment: {
			label: "Experiment plot (crop + management + location)",
			groups: ["crop", "management", "location", "soil"],
		},
		livestock: {
			label: "Livestock survey",
			groups: ["survey", "livestock", "location", "economic"],
		},
		custom: {
			label: "Custom (choose groups below)",
			groups: [],
		},
	};

	function odkName(name) {
		let s = String(name).replace(/[^a-zA-Z0-9_]/g, "_");
		if (!s || !/^[a-zA-Z]/.test(s)) s = "v_" + s;
		return s;
	}

	function listNameForVocab(key) {
		return "voc_" + String(key).replace(/[^a-zA-Z0-9_]/g, "_");
	}

	function groupLabel(group) {
		return GROUP_LABELS[group] || group.replace(/_/g, " ");
	}

	function parseVocabKeys(vocabulary) {
		if (!vocabulary) return [];
		return String(vocabulary)
			.split(";")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function variableLabel(v) {
		const desc = (v.description || "").trim();
		const unit = (v.unit || "").trim();
		let label = desc || v.name.replace(/_/g, " ");
		if (unit) label += ` (${unit})`;
		return label;
	}

	function isRequired(v) {
		return v.required === "yes" ? "yes" : "";
	}

	function numericConstraint(v) {
		const parts = [];
		const min = (v.valid_min || "").trim();
		const max = (v.valid_max || "").trim();
		if (min) parts.push(`. >= ${min}`);
		if (max) parts.push(`. <= ${max}`);
		if (!parts.length) return { constraint: "", message: "" };
		const constraint = parts.join(" and ");
		const message = `Value must be ${min ? `at least ${min}` : ""}${min && max ? " and " : ""}${max ? `at most ${max}` : ""}`;
		return { constraint, message };
	}

	function odkFieldType(v) {
		const t = (v.type || "").trim().toLowerCase();
		if (t === "logical") {
			return { type: "select_one", list: LOGICAL_LIST };
		}
		if (t === "date") return { type: "date" };
		if (t === "time") return { type: "time" };
		if (t === "integer") {
			const c = numericConstraint(v);
			return { type: "integer", constraint: c.constraint, constraint_message: c.message };
		}
		if (t === "numeric") {
			const c = numericConstraint(v);
			return { type: "decimal", constraint: c.constraint, constraint_message: c.message };
		}
		const vocabKeys = parseVocabKeys(v.vocabulary);
		if (t === "character" && vocabKeys.length > 0) {
			const list = listNameForVocab(vocabKeys[0]);
			if (v.multiple_allowed === "yes") {
				return { type: "select_multiple", list };
			}
			return { type: "select_one", list };
		}
		if (t === "wkt") return { type: "text", hint: "WKT geometry" };
		return { type: "text" };
	}

	function valueEntryLabel(entry) {
		if (typeof entry === "string") return entry;
		if (entry && entry.name) return String(entry.name);
		return "";
	}

	function valueEntryName(entry) {
		if (typeof entry === "string") return entry;
		if (entry && entry.name) return String(entry.name);
		return "";
	}

	function buildChoiceRows(vocabValues) {
		const rows = [];
		const usedLists = new Set();

		// Standard yes/no for logical fields
		rows.push({ list_name: LOGICAL_LIST, name: "true", label: "Yes" });
		rows.push({ list_name: LOGICAL_LIST, name: "false", label: "No" });

		for (const [key, entries] of Object.entries(vocabValues || {})) {
			const listName = listNameForVocab(key);
			if (usedLists.has(listName)) continue;
			usedLists.add(listName);
			if (!Array.isArray(entries)) continue;
			for (const entry of entries) {
				const name = valueEntryName(entry);
				if (!name) continue;
				rows.push({
					list_name: listName,
					name: name,
					label: valueEntryLabel(entry),
				});
			}
		}
		return rows;
	}

	function collectNeededLists(variables) {
		const lists = new Set([LOGICAL_LIST]);
		for (const v of variables) {
			const field = odkFieldType(v);
			if (field.list) lists.add(field.list);
		}
		return lists;
	}

	function filterChoiceRows(allRows, neededLists) {
		return allRows.filter((r) => neededLists.has(r.list_name));
	}

	function buildSurveyRows(variables, options) {
		const rows = [];
		let currentGroup = null;

		for (const v of variables) {
			if (v.group !== currentGroup) {
				if (currentGroup !== null) {
					rows.push({ type: "end group", name: "", label: "" });
				}
				currentGroup = v.group;
				rows.push({
					type: "begin group",
					name: odkName("grp_" + currentGroup),
					label: groupLabel(currentGroup),
				});
			}
			const field = odkFieldType(v);
			const hintParts = [];
			if (v.notes) hintParts.push(v.notes);
			const vocabKeys = parseVocabKeys(v.vocabulary);
			if (vocabKeys.length > 1) {
				hintParts.push(`Vocabulary: ${vocabKeys.join(", ")} (first list used in form)`);
			}
			if (v.NAok === "yes") hintParts.push("Missing value allowed in Carob");
			rows.push({
				type: field.type,
				name: odkName(v.name),
				label: variableLabel(v),
				hint: hintParts.join(" · "),
				required: isRequired(v),
				list: field.list || "",
				constraint: field.constraint || "",
				constraint_message: field.constraint_message || "",
			});
		}
		if (currentGroup !== null) {
			rows.push({ type: "end group", name: "", label: "" });
		}
		return rows;
	}

	function odkTypeDisplay(v) {
		const field = odkFieldType(v);
		if (field.type === "select_one" || field.type === "select_multiple") {
			return field.list ? `${field.type} ${field.list}` : field.type;
		}
		return field.type;
	}

	function surveyRowToCells(row) {
		let type = row.type || "";
		if (type === "select_one" || type === "select_multiple") {
			type = row.list ? `${type} ${row.list}` : type;
		}
		return [
			type,
			row.name || "",
			row.label || "",
			row.hint || "",
			row.required || "",
			"",
			"",
			"",
			row.constraint || "",
			row.constraint_message || "",
		];
	}

	function buildXlsForm(vocab, selectedVariables, formMeta) {
		const surveyLogical = buildSurveyRows(selectedVariables, {
			groupOrder: formMeta.groupOrder,
		});
		const allChoices = buildChoiceRows(vocab.values);
		const needed = collectNeededLists(selectedVariables);
		const choiceRows = filterChoiceRows(allChoices, needed);

		const surveyAoA = [SURVEY_HEADERS];
		for (const row of surveyLogical) {
			surveyAoA.push(surveyRowToCells(row));
		}

		const choicesAoA = [CHOICES_HEADERS];
		for (const row of choiceRows) {
			choicesAoA.push([row.list_name, row.name, row.label]);
		}

		const settingsAoA = [
			SETTINGS_HEADERS,
			[
				formMeta.title || "terminag form",
				formMeta.id || "terminag_form",
				formMeta.version || "1",
				"en",
				"",
			],
		];

		return { survey: surveyAoA, choices: choicesAoA, settings: settingsAoA };
	}

	function writeXlsx(sheets, filename) {
		if (typeof XLSX === "undefined") {
			throw new Error("SheetJS (XLSX) is not loaded");
		}
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.survey), "survey");
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.choices), "choices");
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.settings), "settings");
		XLSX.writeFile(wb, filename);
	}

	function groupVariables(vocab) {
		const groups = new Map();
		for (const v of vocab.variables || []) {
			if (isExcludedOdkGroup(v.group)) continue;
			if (!groups.has(v.group)) groups.set(v.group, []);
			groups.get(v.group).push(v);
		}
		for (const vars of groups.values()) {
			vars.sort((a, b) => a.name.localeCompare(b.name));
		}
		return groups;
	}

	function variablesForGroups(vocab, groupNames) {
		const set = new Set(groupNames);
		return (vocab.variables || []).filter((v) => set.has(v.group) && !isExcludedOdkGroup(v.group));
	}

	function defaultFieldGroups(vocab) {
		const groups = new Set();
		for (const v of vocab.variables || []) {
			if (!isExcludedOdkGroup(v.group)) groups.add(v.group);
		}
		return [...groups].sort();
	}

	function sortGroupNames(names) {
		const order = Object.keys(GROUP_LABELS);
		return [...names].sort((a, b) => {
			const ia = order.indexOf(a);
			const ib = order.indexOf(b);
			if (ia >= 0 && ib >= 0) return ia - ib;
			if (ia >= 0) return -1;
			if (ib >= 0) return 1;
			return a.localeCompare(b);
		});
	}

	global.CarobOdk = {
		PRESETS,
		GROUP_LABELS,
		groupVariables,
		variablesForGroups,
		defaultFieldGroups,
		sortGroupNames,
		groupLabel,
		buildXlsForm,
		writeXlsx,
		variableLabel,
		odkTypeDisplay,
	};
})(typeof window !== "undefined" ? window : globalThis);
