/**
 * Balance Sheet Extension - Extract accounting PDFs and generate balance sheets
 *
 * Provides:
 * - `balance_sheet` tool: Extracts PDFs from a folder, reads extracted text,
 *   and instructs the LLM to generate a structured balance sheet
 * - `/balance-sheet <folder>` command: Quick interactive entry point
 *
 * Extraction uses the pdf-extractor skill with a consistent accounting-focused
 * prompt so every run produces the same structured output.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, basename, extname, dirname } from "node:path";

// ─── Constants ────────────────────────────────────────────────────────────────

const EXTRACT_SCRIPT = "/home/yogibear54/.pi/agent/skills/pdf-extractor/scripts/extract.py";

const ACCOUNTING_PROMPT = [
	"Extract this PDF as a markdown document. These are financial/accounting statements.",
	"",
	"Extract ALL of the following:",
	"1. Statement date and account details (account number, currency)",
	"2. Previous/opening balance",
	"3. Every transaction with: post date, transaction date, description, amount, and type (Debit/Credit or CR)",
	"4. Statement/closing balance",
	"",
	"CRITICAL: Verify the arithmetic flow: Previous Balance + Charges - Payments = Statement Balance.",
	"If it doesn't balance, clearly state the discrepancy.",
	"",
	"Format transactions as a markdown table: | Post Date | Trans Date | Description | Amount | Type |",
].join("\n");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedPdf {
	pdfName: string;
	mdPath: string;
}

interface BalanceSheetDetails {
	folder: string;
	type: string;
	pdfsFound: number;
	pdfsExtracted: number;
	extractedFiles: ExtractedPdf[];
	combinedPath: string;
	outputPath: string;
	errors: string[];
}

// ─── PDF discovery & extraction ───────────────────────────────────────────────

function findPdfs(folder: string): string[] {
	return readdirSync(folder)
		.filter((f) => extname(f).toLowerCase() === ".pdf")
		.sort()
		.map((f) => join(folder, f));
}

function extractPdf(pdfPath: string): { mdPath: string; error?: string } {
	// The pdf-extractor saves .md alongside the .pdf
	const expectedMd = join(dirname(pdfPath), basename(pdfPath, ".pdf") + ".md");

	try {
		execFileSync(
			EXTRACT_SCRIPT,
			[
				pdfPath,
				"--mode", "prompt",
				"--output", "markdown",
				"--image-max-long-edge", "2048",
				"--dpi", "150",
				"--prompt", ACCOUNTING_PROMPT,
			],
			{
				encoding: "utf-8",
				timeout: 300_000, // 5 minutes per PDF
				maxBuffer: 50 * 1024 * 1024,
			},
		);

		if (existsSync(expectedMd)) {
			return { mdPath: expectedMd };
		}

		return { mdPath: expectedMd, error: "Markdown file not created" };
	} catch (err: any) {
		// Check if it partially succeeded (file exists despite error exit)
		if (existsSync(expectedMd)) {
			return { mdPath: expectedMd };
		}
		return { mdPath: expectedMd, error: err.stderr || err.message || String(err) };
	}
}

// ─── Combined markdown generation ─────────────────────────────────────────────

function buildCombinedMarkdown(folder: string, extracted: ExtractedPdf[], errors: string[]): string {
	const parts: string[] = [];

	parts.push(`# Combined Extraction — ${basename(folder)}`);
	parts.push(`Extracted: ${new Date().toISOString()}`);
	parts.push(`Files: ${extracted.length}`);
	if (errors.length > 0) {
		parts.push(`\n## Errors\n${errors.map((e) => `- ${e}`).join("\n")}`);
	}
	parts.push("\n---\n");

	for (const { pdfName, mdPath } of extracted) {
		try {
			const content = readFileSync(mdPath, "utf-8");
			parts.push(`## ${pdfName}\n\n${content}\n\n---\n`);
		} catch {
			parts.push(`## ${pdfName}\n\n*Failed to read extracted file*\n\n---\n`);
		}
	}

	return parts.join("\n");
}

// ─── Balance sheet template (instructions for the LLM) ────────────────────────

function buildInstructions(
	folder: string,
	type: string,
	extracted: ExtractedPdf[],
	combinedPath: string,
	outputPath: string,
	errors: string[],
): string {
	return [
		`Successfully extracted ${extracted.length} PDF(s) from: \`${folder}\``,
		`Combined extraction saved to: \`${combinedPath}\``,
		``,
		`## Next Steps`,
		``,
		`Read \`${combinedPath}\` and generate a structured balance sheet at \`${outputPath}\`.`,
		`The balance sheet should follow this exact format:`,
		``,
		`### Required Sections`,
		``,
		`1. **Monthly Summary** — table with columns: Statement Date | Previous Balance | Payments (CR) | New Charges | Statement Balance | Verified`,
		`2. **Totals** — Total Payments, Total Charges, Ending Statement Balance`,
		`3. **Charges by Vendor** — aggregated and sorted by total amount descending, with % of total`,
		`4. **Expense Category Summary** — group vendors into categories (Cloud/Hosting, SaaS, Shipping, etc.)`,
		`5. **Payment Schedule** — all credit/payment transactions`,
		`6. **Outstanding Balance** — the ending statement balance`,
		`7. **Notes** — verification status, any discrepancies, currency info`,
		``,
		`### Verification Rules`,
		`- For EACH statement: Previous Balance + Charges − Payments MUST equal Statement Balance`,
		`- Mark each statement ✅ or ❌`,
		`- If there's a discrepancy, note it clearly`,
		`- Sum all charges across all statements for the grand total`,
		``,
		`### Vendor Normalization`,
		`- Group similar vendor names (e.g. "GOOGLE*GSUITE JUSTSAKE" and "GOOGLE*GSUITE" → "Google Workspace")`,
		`- Separate Google Workspace from Google Cloud`,
		`- Normalize AWS, DigitalOcean, and other recurring vendors`,
		``,
		`Document type: ${type}`,
		errors.length > 0 ? `\nWarnings:\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
	].join("\n");
}

// ─── Tool parameter schema ────────────────────────────────────────────────────

const BalanceSheetParams = Type.Object({
	folder: Type.String({
		description: "Path to the folder containing PDF files (e.g. credit card statements, bank statements, invoices)",
	}),
	type: StringEnum(["credit_card", "bank", "invoice", "auto"] as const, {
		description: "Type of accounting documents. 'auto' tries to detect from content.",
	}),
	output: Type.Optional(Type.String({
		description: "Output filename for the balance sheet markdown. Defaults to 'balance-sheet.md'.",
	})),
});

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Tool: balance_sheet ──────────────────────────────────────────────
	pi.registerTool({
		name: "balance_sheet",
		label: "Balance Sheet",
		description:
			"Extract accounting PDFs from a folder and generate a structured balance sheet. " +
			"Finds all .pdf files, extracts each using OCR with an accounting-focused prompt, " +
			"then combines the results for balance sheet generation. " +
			"Supports credit card statements, bank statements, and invoices.",
		promptSnippet: "Generate a balance sheet from PDF statements in a folder",
		promptGuidelines: [
			"Use balance_sheet when the user wants financial analysis of PDF documents in a folder.",
			"The tool extracts PDFs; you then read the combined output and write the final balance sheet.",
		],
		parameters: BalanceSheetParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const folder = resolve(ctx.cwd, params.folder);
			const outputName = params.output || "balance-sheet.md";
			const outputPath = join(folder, outputName);

			// Validate
			if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
			if (!statSync(folder).isDirectory()) throw new Error(`Not a directory: ${folder}`);

			const pdfs = findPdfs(folder);
			if (pdfs.length === 0) throw new Error(`No PDF files found in: ${folder}`);

			onUpdate?.({ content: [{ type: "text", text: `Found ${pdfs.length} PDF(s). Starting extraction...` }] });

			const errors: string[] = [];
			const extracted: ExtractedPdf[] = [];

			for (let i = 0; i < pdfs.length; i++) {
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "Cancelled" }], details: {} };
				}

				const pdfName = basename(pdfs[i]);
				onUpdate?.({
					content: [{ type: "text", text: `Extracting ${i + 1}/${pdfs.length}: ${pdfName}` }],
				});

				const result = extractPdf(pdfs[i]);

				if (!result.error) {
					extracted.push({ pdfName, mdPath: result.mdPath });
				} else {
					// Check if file was created despite error
					if (existsSync(result.mdPath)) {
						extracted.push({ pdfName, mdPath: result.mdPath });
						errors.push(`${pdfName}: extracted with warning — ${result.error}`);
					} else {
						errors.push(`${pdfName}: FAILED — ${result.error}`);
					}
				}
			}

			if (extracted.length === 0) {
				throw new Error(`All extractions failed:\n${errors.join("\n")}`);
			}

			// Build and save combined extraction
			const combinedPath = join(folder, "_extracted-combined.md");
			const combinedContent = buildCombinedMarkdown(folder, extracted, errors);
			writeFileSync(combinedPath, combinedContent, "utf-8");

			// Return instructions for the LLM to generate the final balance sheet
			const instructions = buildInstructions(folder, params.type, extracted, combinedPath, outputPath, errors);

			return {
				content: [{ type: "text", text: instructions }],
				details: {
					folder,
					type: params.type,
					pdfsFound: pdfs.length,
					pdfsExtracted: extracted.length,
					extractedFiles: extracted,
					combinedPath,
					outputPath,
					errors,
				} as BalanceSheetDetails,
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("balance_sheet "));
			text += theme.fg("accent", args.type || "auto");
			text += " " + theme.fg("dim", args.folder);
			if (args.output) {
				text += theme.fg("muted", ` → ${args.output}`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as BalanceSheetDetails | undefined;
			if (!details) return new Text(theme.fg("dim", "Done"), 0, 0);

			const check = details.pdfsExtracted === details.pdfsFound
				? theme.fg("success", "✓")
				: theme.fg("warning", "⚠");

			let text = `${check} Extracted ${details.pdfsExtracted}/${details.pdfsFound} PDFs`;

			if (expanded && details.extractedFiles.length > 0) {
				for (const f of details.extractedFiles) {
					text += `\n  ${theme.fg("dim", `📄 ${f.pdfName}`)}`;
				}
				text += `\n  ${theme.fg("muted", `Combined: ${details.combinedPath}`)}`;
				text += `\n  ${theme.fg("muted", `Output: ${details.outputPath}`)}`;
			}

			if (details.errors.length > 0) {
				text += ` ${theme.fg("warning", `(${details.errors.length} warning(s))`)}`;
				if (expanded) {
					for (const err of details.errors) {
						text += `\n  ${theme.fg("warning", `⚠ ${err}`)}`;
					}
				}
			}

			return new Text(text, 0, 0);
		},
	});

	// ── Command: /balance-sheet ──────────────────────────────────────────
	pi.registerCommand("balance-sheet", {
		description: "Generate a balance sheet from PDFs in a folder. Usage: /balance-sheet <folder-path>",
		handler: async (args, ctx) => {
			const folder = args?.trim();
			if (!folder) {
				ctx.ui.notify("Usage: /balance-sheet <folder-path>", "warning");
				return;
			}

			const resolvedPath = resolve(ctx.cwd, folder);
			if (!existsSync(resolvedPath)) {
				ctx.ui.notify(`Folder not found: ${resolvedPath}`, "error");
				return;
			}

			pi.sendUserMessage(
				`Generate a balance sheet from the PDFs in ${resolvedPath}. Use the balance_sheet tool with folder="${resolvedPath}" and type="auto". After extraction, read the combined file and write the final balance sheet.`,
			);
		},
	});
}
