/**
 * Import professionals from an Excel (.xlsx or .xls) file into Firestore.
 * Uses the Excel "id" column as leadId: if a document with that ID exists, it is updated (merge);
 * otherwise a new document is created. Re-running the import updates existing rows (no duplicates).
 * Requires: GOOGLE_APPLICATION_CREDENTIALS pointing to a service account key JSON (can be in .env).
 * Usage: node scripts/import-excel.js <path-to-file.xlsx>
 * Dry run (no Firebase): node scripts/import-excel.js --dry-run <path-to-file.xlsx>
 */

import dotenv from "dotenv";
dotenv.config();

import XLSX from "xlsx";
import { createHash } from "crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Greek to Latin (Greeklish) for search normalization – same logic as dashboard
const GREEK_TO_LATIN = {
	α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
	ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
	ά: "a", έ: "e", ή: "i", ί: "i", ό: "o", ύ: "y", ώ: "o", ϋ: "y", ΐ: "i", ΰ: "y",
	Α: "a", Β: "v", Γ: "g", Δ: "d", Ε: "e", Ζ: "z", Η: "i", Θ: "th", Ι: "i", Κ: "k", Λ: "l", Μ: "m",
	Ν: "n", Ξ: "x", Ο: "o", Π: "p", Ρ: "r", Σ: "s", Τ: "t", Υ: "y", Φ: "f", Χ: "ch", Ψ: "ps", Ω: "o",
	Ά: "a", Έ: "e", Ή: "i", Ί: "i", Ό: "o", Ύ: "y", Ώ: "o", Ϊ: "i", Ϋ: "y",
};

const LOCATION_ALIASES = {
	athina: ["athens", "athina"],
	αθηνα: ["athens", "athina"],
	thessaloniki: ["thessaloniki", "salonika", "thessaloniki"],
	θεσσαλονικη: ["thessaloniki", "salonika"],
	kefalonia: ["kefalonia", "cefalonia", "kefalonia"],
	κεφαλονια: ["kefalonia", "cefalonia"],
	argostoli: ["argostoli", "argostoli"],
	αργοστολι: ["argostoli"],
	patra: ["patras", "patra"],
	πατρα: ["patras", "patra"],
	irakleio: ["heraklion", "irakleio", "crete"],
	ηρακλειο: ["heraklion", "irakleio"],
	larisa: ["larissa", "larisa"],
	λαρισα: ["larissa", "larisa"],
	volos: ["volos"],
	βολος: ["volos"],
};

function normalizeLocationToken(str) {
	if (str == null || typeof str !== "string") return "";
	// Strip punctuation so "Λαμία!" and "Λαμία" both become "lamia"
	let s = str.trim().toLowerCase().replace(/\s+/g, " ").replace(/[!?.,;:–—_'"()[\]{}]/g, " ");
	let out = "";
	for (let i = 0; i < s.length; i++) {
		out += GREEK_TO_LATIN[s[i]] ?? s[i];
	}
	return out.replace(/\s+/g, " ").trim();
}

function buildLocationSearch(location) {
	if (!location || typeof location !== "string") return [];
	const trimmed = location.trim();
	if (!trimmed) return [];
	const full = normalizeLocationToken(trimmed);
	const words = trimmed.split(/[\s,]+/).map((w) => normalizeLocationToken(w)).filter(Boolean);
	const seen = new Set();
	[full, ...words].forEach((t) => {
		if (t) seen.add(t);
	});
	Object.keys(LOCATION_ALIASES).forEach((key) => {
		if (full.includes(key) || words.some((w) => w === key || key.includes(w))) {
			LOCATION_ALIASES[key].forEach((alias) => seen.add(alias));
		}
	});
	return [...seen];
}

const COLUMN_MAPPING = [
	{ excel: "id", firestore: "leadId" },
	{ excel: "created_time", firestore: "createdAt" },
	{ excel: "form_name", firestore: "formName" },
	{ excel: "platform", firestore: "platform" },
	{ excel: "instagram_ή_tiktok_user", firestore: "socialUrl" },
	{ excel: "instagram_ή_tiktok_username", firestore: "socialUrl" },
	{ excel: "followers_έχεις_περίπου", firestore: "followers" },
	{ excel: "πόσους_followers_έχεις_περίπου", firestore: "followers" },
	{ excel: "τι_είδους_content_δημιουργείς", firestore: "contentType" },
	{ excel: "τι_είδους_content_δημιουργείς_κυρίως", firestore: "contentType" },
	{ excel: "ποιος_είναι_ο_βασικός_σου_ρόλος", firestore: "mainRole" },
	{ excel: "ποιος_είναι_ο_βασικός_σο", firestore: "mainRole" },
	{ excel: "τι_είδους_συνεργασία_σε", firestore: "collaborationType" },
	{ excel: "σε_ποια_πόλη_ή_περιοχή", firestore: "location" },
	{ excel: "τι_εξοπλισμό_χρησιμοποιεί", firestore: "equipment" },
	{ excel: "link_σε_portfolio_/_vimeo_/_drive", firestore: "portfolioUrl" },
	{ excel: "link_σε_portfolio_/_vimec", firestore: "portfolioUrl" },
	{ excel: "link_σε_portfolio", firestore: "portfolioUrl" },
	{ excel: "γιατί_σε_ενδιαφέρει_συνεργασία_με_την_itdev", firestore: "bio" },
	{ excel: "γιατί_σε_ενδιαφέρει_συνει", firestore: "bio" },
	{ excel: "ονοματεπώνυμο", firestore: "name" },
	{ excel: "αριθμός_τηλεφώνου", firestore: "phone" },
	{ excel: "email", firestore: "email" },
	{ excel: "επαγγελματικός_τίτλος", firestore: "category" },
];

function normalizeCategory(value, mainRoleRaw, formNameRaw) {
	if (value == null || value === "") value = "";
	const v = String(value).trim().toLowerCase();
	const role = String(mainRoleRaw ?? "").trim().toLowerCase();
	const formName = String(formNameRaw ?? "").trim().toLowerCase();
	if (v === "influencer" || v.includes("influencer") || formName.includes("influencer")) return "influencer";
	if (v === "videographer" || v === "βιντεογράφος" || v.includes("videographer") || v.includes("βιντεογράφ") || role.includes("videographer")) return "videographer";
	if (v === "editor" || v === "συντακτης" || v === "συντακτής" || v.includes("editor") || v.includes("συντακτ") || role.includes("editor")) return "editor";
	if (role.includes("videographer") && role.includes("editor")) return "videographer";
	if (v === "model" || v.includes("model")) return "model";
	return v || "videographer";
}

function trimAndEmptyToUndefined(s) {
	if (s == null) return undefined;
	const t = String(s).trim();
	return t === "" ? undefined : t;
}

function stableLeadId(createdAt, email, name) {
	const raw = [String(createdAt ?? ""), String(email ?? ""), String(name ?? "")].join("|");
	return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

function buildColumnIndex(headers) {
	const index = {};
	for (let i = 0; i < headers.length; i++) {
		const header = String(headers[i] ?? "").trim().replace(/[;?]$/, "");
		for (const { excel, firestore } of COLUMN_MAPPING) {
			const ex = excel.replace(/[;?]$/, "");
			const exactMatch = header === ex;
			const looseMatch = header.startsWith(ex) || ex.startsWith(header) || header.includes(ex) || ex.includes(header);
			if (ex === "id" ? exactMatch : looseMatch) {
				index[firestore] = i;
				break;
			}
		}
	}
	return index;
}

function rowToDoc(row, colIndex, forcedCategory) {
	const get = (field) => {
		const i = colIndex[field];
		return i !== undefined ? row[i] : undefined;
	};

	const categoryRaw = get("category");
	const mainRoleRaw = get("mainRole");
	const formNameRaw = get("formName");
	const category = forcedCategory || normalizeCategory(categoryRaw, mainRoleRaw, formNameRaw);
	const location = trimAndEmptyToUndefined(get("location"));
	const name = trimAndEmptyToUndefined(get("name"));

	if (!name && !location && !category) return null;

	const locationSearch = buildLocationSearch(location || "");
	let leadIdRaw = get("leadId");
	let leadId = leadIdRaw != null && String(leadIdRaw).trim() !== "" ? String(leadIdRaw).trim().replace(/\//g, "_") : undefined;
	if (!leadId) {
		const createdAt = get("createdAt");
		const email = get("email");
		leadId = "influencer_" + stableLeadId(createdAt, email, name);
	}

	const doc = {
		...(leadId ? { leadId } : {}),
		category: category || "videographer",
		location: location || "",
		name: name || "",
		locationSearch: locationSearch.length ? locationSearch : undefined,
		bio: trimAndEmptyToUndefined(get("bio")),
		portfolioUrl: trimAndEmptyToUndefined(get("portfolioUrl")),
		socialUrl: trimAndEmptyToUndefined(get("socialUrl")),
		phone: trimAndEmptyToUndefined(get("phone")),
		email: trimAndEmptyToUndefined(get("email")),
		createdAt: trimAndEmptyToUndefined(get("createdAt")),
		platform: trimAndEmptyToUndefined(get("platform")),
		mainRole: trimAndEmptyToUndefined(get("mainRole")),
		collaborationType: trimAndEmptyToUndefined(get("collaborationType")),
		equipment: trimAndEmptyToUndefined(get("equipment")),
		followers: trimAndEmptyToUndefined(get("followers")),
		contentType: trimAndEmptyToUndefined(get("contentType")),
	};

	Object.keys(doc).forEach((k) => {
		if (doc[k] === undefined) delete doc[k];
	});
	return doc;
}

async function main() {
	const argv = process.argv.slice(2);
	const isDryRun = argv.includes("--dry-run");
	const categoryArg = argv.find((a) => a.startsWith("--category="));
	const forcedCategory = categoryArg ? categoryArg.split("=")[1] : null;
	const filePath = argv.filter((a) => a !== "--dry-run" && !a.startsWith("--category="))[0];
	if (!filePath) {
		console.error("Usage: node scripts/import-excel.js [--dry-run] [--category=influencer] <path-to-file.xlsx>");
		process.exit(1);
	}

	const absolutePath = resolve(filePath.startsWith("/") ? "" : process.cwd(), filePath);
	if (!existsSync(absolutePath)) {
		console.error("File not found:", absolutePath);
		process.exit(1);
	}

	const workbook = XLSX.readFile(absolutePath);
	const sheetName = workbook.SheetNames[0];
	const sheet = workbook.Sheets[sheetName];
	const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

	if (rows.length < 2) {
		console.error("Sheet must have a header row and at least one data row.");
		process.exit(1);
	}

	const headers = rows[0];
	const colIndex = buildColumnIndex(headers);

	if (isDryRun) {
		console.log("Headers (row 0):", headers);
		console.log("Mapped column index:", colIndex);
		if (rows.length > 1) console.log("First data row:", rows[1]);
		console.log("Dry run done. Run without --dry-run and GOOGLE_APPLICATION_CREDENTIALS to import.");
		return;
	}

	const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	const absoluteCredPath = credPath ? resolve(credPath) : null;
	if (!absoluteCredPath || !existsSync(absoluteCredPath)) {
		console.error("Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.");
		process.exit(1);
	}
	const credential = JSON.parse(readFileSync(absoluteCredPath, "utf8"));
	initializeApp({ credential: cert(credential) });
	const db = getFirestore();

	const docs = [];
	for (let r = 1; r < rows.length; r++) {
		const doc = rowToDoc(rows[r], colIndex, forcedCategory);
		if (doc) docs.push(doc);
	}

	const BATCH_SIZE = 500;
	let written = 0;
	const collection = db.collection("professionals");

	for (let i = 0; i < docs.length; i += BATCH_SIZE) {
		const batch = db.batch();
		const chunk = docs.slice(i, i + BATCH_SIZE);
		chunk.forEach((doc) => {
			const docId = doc.leadId ? String(doc.leadId) : null;
			const ref = docId ? collection.doc(docId) : collection.doc();
			batch.set(ref, doc, docId ? { merge: true } : {});
		});
		await batch.commit();
		written += chunk.length;
		console.log(`Written ${written}/${docs.length} documents (updates by leadId where present).`);
	}

	console.log("Import complete. Total documents written:", written);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
