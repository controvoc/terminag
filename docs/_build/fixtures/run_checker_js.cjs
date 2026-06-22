#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const args = process.argv.slice(2);
const scriptDir = __dirname;
const fixturesDir = args[0] ? path.resolve(args[0]) : scriptDir;
const outputPath = args[1] ? path.resolve(args[1]) : path.join(fixturesDir, "js_results.json");

const terminagRoot = path.resolve(fixturesDir, "..", "..", "..");
const checkerPath = path.join(terminagRoot, "docs", "assets", "checker.js");
const vocabPath = path.join(terminagRoot, "vocab.json");

function loadChecker() {
	const code = fs.readFileSync(checkerPath, "utf8");
	const sandbox = { globalThis: {} };
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox);
	return sandbox.CarobCheck || sandbox.globalThis.CarobCheck;
}

function sortIssues(issues) {
	return [...issues].sort((a, b) => {
		const ka = `${a.check}\t${a.msg}`;
		const kb = `${b.check}\t${b.msg}`;
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	});
}

function readMetadataRow(CarobCheck, filePath) {
	const text = fs.readFileSync(filePath, "utf8");
	const table = CarobCheck.parseCSV(text);
	if (!table.rows.length) return null;
	return table.rows[0];
}

const CarobCheck = loadChecker();
const vocab = JSON.parse(fs.readFileSync(vocabPath, "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(fixturesDir, "cases.json"), "utf8"));

const results = {};
for (const caseDef of cases) {
	let records = null;
	let metadata = null;
	if (caseDef.records) {
		const text = fs.readFileSync(path.join(fixturesDir, caseDef.records), "utf8");
		records = CarobCheck.parseCSV(text);
	}
	if (caseDef.metadata) {
		metadata = readMetadataRow(CarobCheck, path.join(fixturesDir, caseDef.metadata));
	}
	const issues = CarobCheck.checkTerms({
		vocab,
		records,
		metadata,
		check: "nogeo",
	});
	results[caseDef.id] = sortIssues(issues);
}

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
console.log(`Wrote ${outputPath}`);
