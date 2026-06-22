/* CSV / Excel upload helpers for the terminag checker. */
(function (global) {
	"use strict";

	function isXlsxFile(file) {
		if (!file) return false;
		const name = (file.name || "").toLowerCase();
		if (name.endsWith(".xlsx") || name.endsWith(".xls")) return true;
		const type = (file.type || "").toLowerCase();
		return type.includes("spreadsheet") || type.includes("excel");
	}

	function readArrayBuffer(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(file);
		});
	}

	async function readWorkbook(file) {
		if (typeof global.XLSX === "undefined") {
			throw new Error("Excel support is not loaded (missing SheetJS).");
		}
		const data = await readArrayBuffer(file);
		return global.XLSX.read(data, {
			type: "array",
			cellDates: true,
			raw: false,
		});
	}

	function formatCell(value) {
		if (value === null || value === undefined) return "";
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) return "";
			return value.toISOString().slice(0, 10);
		}
		if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
		return String(value);
	}

	function sheetToTable(workbook, sheetName) {
		if (!workbook || !sheetName) return { columns: [], rows: [] };
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) return { columns: [], rows: [] };
		const grid = global.XLSX.utils.sheet_to_json(sheet, {
			header: 1,
			defval: "",
			raw: false,
		});
		if (!grid || grid.length === 0) return { columns: [], rows: [] };

		const nonEmpty = grid.filter(row =>
			Array.isArray(row) && row.some(cell => formatCell(cell) !== "")
		);
		if (nonEmpty.length === 0) return { columns: [], rows: [] };

		const columns = nonEmpty[0].map(h => formatCell(h).trim().replace(/^\ufeff/, ""));
		const rows = [];
		for (let r = 1; r < nonEmpty.length; r++) {
			const cells = nonEmpty[r];
			if (!Array.isArray(cells)) continue;
			if (cells.every(c => formatCell(c) === "")) continue;
			const obj = {};
			for (let c = 0; c < columns.length; c++) {
				obj[columns[c]] = cells[c] !== undefined ? formatCell(cells[c]) : "";
			}
			rows.push(obj);
		}
		return { columns, rows };
	}

	function sheetNames(workbook) {
		return workbook && workbook.SheetNames ? workbook.SheetNames.slice() : [];
	}

	global.CarobSpreadsheet = {
		isXlsxFile,
		readWorkbook,
		sheetNames,
		sheetToTable,
	};

})(typeof window !== "undefined" ? window : globalThis);
