/**
 * SQLite-backed persistent symbol index.
 * Stores symbols and file metadata for fast lookup.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export interface SymbolRecord {
	id: number;
	file: string;
	name: string;
	kind: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	signature: string | null;
	scope: string | null;
	visibility: string | null;
	documentation: string | null;
	parentId: number | null;
}

/**
 * Map a raw DB row (snake_case columns) to a SymbolRecord (camelCase).
 * `SELECT *` returns snake_case keys from SQLite; this normalizes them.
 */
function toSymbolRecord(row: any): SymbolRecord {
	return {
		id: row.id,
		file: row.file,
		name: row.name,
		kind: row.kind,
		line: row.line,
		column: row.column,
		endLine: row.end_line,
		endColumn: row.end_column,
		signature: row.signature,
		scope: row.scope,
		visibility: row.visibility,
		documentation: row.documentation,
		parentId: row.parent_id,
	};
}

/** Map an array of raw DB rows to SymbolRecord[]. */
function toSymbolRecords(rows: any[]): SymbolRecord[] {
	return rows.map(toSymbolRecord);
}

export interface EdgeRecord {
	id: number;
	sourceFile: string;
	sourceSymbol: string | null;
	targetFile: string | null;
	targetSymbol: string | null;
	relationship: string; // 'imports', 're_exports', 'extends', 'implements'
	line: number;
	rawSource: string | null; // original import path string (e.g., "./utils")
}

/** Map a raw DB row to an EdgeRecord. */
function toEdgeRecord(row: any): EdgeRecord {
	return {
		id: row.id,
		sourceFile: row.source_file,
		sourceSymbol: row.source_symbol,
		targetFile: row.target_file,
		targetSymbol: row.target_symbol,
		relationship: row.relationship,
		line: row.line,
		rawSource: row.raw_source,
	};
}

function toEdgeRecords(rows: any[]): EdgeRecord[] {
	return rows.map(toEdgeRecord);
}

export interface FileRecord {
	path: string;
	language: string;
	hash: string;
	lastIndexedAt: number;
	symbolCount: number;
}

export interface DatabaseConfig {
	journalMode: string;
	synchronous: string;
	cacheSizeMB: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  hash TEXT NOT NULL,
  last_indexed_at INTEGER NOT NULL,
  symbol_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  signature TEXT,
  scope TEXT,
  visibility TEXT,
  documentation TEXT,
  parent_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
CREATE INDEX IF NOT EXISTS idx_symbols_scope ON symbols(scope);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  path,
  content,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS content_lines (
  path TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  char_offset INTEGER NOT NULL,
  line_text TEXT NOT NULL,
  PRIMARY KEY (path, line_number)
);

CREATE INDEX IF NOT EXISTS idx_content_lines_path ON content_lines(path);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_symbol TEXT,
  target_file TEXT,
  target_symbol TEXT,
  relationship TEXT NOT NULL,
  line INTEGER NOT NULL,
  raw_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file);
CREATE INDEX IF NOT EXISTS idx_edges_target_file ON edges(target_file);
CREATE INDEX IF NOT EXISTS idx_edges_target_symbol ON edges(target_symbol, relationship);
CREATE INDEX IF NOT EXISTS idx_edges_source_symbol ON edges(source_file, source_symbol);
`;

export class Store {
	private db: Database.Database;
	private stmts!: {
		upsertFile: Database.Statement;
		deleteFile: Database.Statement;
		insertSymbol: Database.Statement;
		deleteSymbolsByFile: Database.Statement;
		findByName: Database.Statement;
		findByNameAndFile: Database.Statement;
		findByNameAndFileBest: Database.Statement;
		findBestDefinition: Database.Statement;
		findMembersOfScope: Database.Statement;
		findByFile: Database.Statement;
		findByKind: Database.Statement;
		searchByName: Database.Statement;
		getFile: Database.Statement;
		getAllFiles: Database.Statement;
		getStats: Database.Statement;
		setMeta: Database.Statement;
		getMeta: Database.Statement;
		countByName: Database.Statement;
		insertFtsContent: Database.Statement;
		deleteFtsByFile: Database.Statement;
		insertContentLine: Database.Statement;
		deleteContentLinesByFile: Database.Statement;
		searchContent: Database.Statement;
		searchContentCount: Database.Statement;
		hasFtsByFile: Database.Statement;
		getContentLinesByFile: Database.Statement;
		getLineByOffset: Database.Statement;
		getStaleFiles: Database.Statement;
		getAllFilesWithMeta: Database.Statement;
		insertEdge: Database.Statement;
		deleteEdgesByFile: Database.Statement;
		findEdgesBySourceFile: Database.Statement;
		findEdgesByTargetFile: Database.Statement;
		findEdgesByTargetSymbol: Database.Statement;
		findEdgesBySourceFileAndSymbol: Database.Statement;
		findEdgesByTargetFileAndRel: Database.Statement;
	};

	constructor(dbPath: string, dbConfig?: DatabaseConfig) {
		// Ensure directory exists
		const dbDir = path.dirname(dbPath);
		fs.mkdirSync(dbDir, { recursive: true });

		// Add .gitignore to keep the database and WAL sidecars out of version control
		const gitignorePath = path.join(dbDir, ".gitignore");
		const gitignoreEntries = ["index.db", "index.db-shm", "index.db-wal"];
		if (!fs.existsSync(gitignorePath)) {
			fs.writeFileSync(gitignorePath, gitignoreEntries.join("\n") + "\n");
		} else {
			const existing = fs.readFileSync(gitignorePath, "utf8");
			const missing = gitignoreEntries.filter((e) => !existing.includes(e));
			if (missing.length > 0) {
				fs.appendFileSync(gitignorePath, missing.join("\n") + "\n");
			}
		}

		const journalMode = dbConfig?.journalMode ?? "WAL";
		const synchronous = dbConfig?.synchronous ?? "NORMAL";
		const cacheSizeMB = dbConfig?.cacheSizeMB ?? 32;

		this.db = new Database(dbPath);
		this.db.pragma(`journal_mode = ${journalMode}`);
		this.db.pragma(`synchronous = ${synchronous}`);
		this.db.pragma(`cache_size = -${cacheSizeMB * 1000}`);

		this.db.exec(SCHEMA);
		this.prepareStatements();
	}

	private prepareStatements() {
		this.stmts = {
			upsertFile: this.db.prepare(`
				INSERT INTO files (path, language, hash, last_indexed_at, symbol_count)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(path) DO UPDATE SET
					language = excluded.language,
					hash = excluded.hash,
					last_indexed_at = excluded.last_indexed_at,
					symbol_count = excluded.symbol_count
			`),

			deleteFile: this.db.prepare("DELETE FROM files WHERE path = ?"),

			insertSymbol: this.db.prepare(`
				INSERT INTO symbols (file, name, kind, line, column, end_line, end_column,
					signature, scope, visibility, documentation, parent_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),

			deleteSymbolsByFile: this.db.prepare("DELETE FROM symbols WHERE file = ?"),

			findByName: this.db.prepare(
				"SELECT * FROM symbols WHERE name = ? ORDER BY kind, file, line",
			),

			findByNameAndFile: this.db.prepare(
				"SELECT * FROM symbols WHERE name = ? AND file = ?",
			),

			findByNameAndFileBest: this.db.prepare(
				"SELECT * FROM symbols WHERE name = ? AND file = ? ORDER BY line LIMIT 1",
			),

			findBestDefinition: this.db.prepare(
				"SELECT * FROM symbols WHERE name = ? ORDER BY kind, file, line LIMIT 1",
			),

			findMembersOfScope: this.db.prepare(
				"SELECT * FROM symbols WHERE file = ? AND scope = ? ORDER BY line",
			),

			insertFtsContent: this.db.prepare(
				"INSERT INTO content_fts (path, content) VALUES (?, ?)",
			),

			deleteFtsByFile: this.db.prepare(
				"DELETE FROM content_fts WHERE path = ?",
			),

			insertContentLine: this.db.prepare(
				"INSERT INTO content_lines (path, line_number, char_offset, line_text) VALUES (?, ?, ?, ?)",
			),

			deleteContentLinesByFile: this.db.prepare(
				"DELETE FROM content_lines WHERE path = ?",
			),

			searchContent: this.db.prepare(`
				SELECT path, content_fts.rank as rank
				FROM content_fts
				WHERE content_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`),

			searchContentCount: this.db.prepare(`
				SELECT COUNT(DISTINCT path) as count
				FROM content_fts
				WHERE content_fts MATCH ?
			`),

			hasFtsByFile: this.db.prepare(
				"SELECT 1 FROM content_fts WHERE path = ? LIMIT 1",
			),

			getContentLinesByFile: this.db.prepare(`
				SELECT line_number, line_text
				FROM content_lines
				WHERE path = ?
				ORDER BY line_number
			`),

			getLineByOffset: this.db.prepare(`
				SELECT line_number, line_text
				FROM content_lines
				WHERE path = ? AND char_offset <= ?
				ORDER BY char_offset DESC
				LIMIT 1
			`),

			getStaleFiles: this.db.prepare(
				"SELECT f.path, f.hash FROM files f",
			),

			getAllFilesWithMeta: this.db.prepare(
				"SELECT path, hash, last_indexed_at as lastIndexedAt FROM files",
			),

			findByFile: this.db.prepare(
				"SELECT * FROM symbols WHERE file = ? ORDER BY line",
			),

			findByKind: this.db.prepare(
				"SELECT * FROM symbols WHERE kind = ? ORDER BY file, line LIMIT ?",
			),

			searchByName: this.db.prepare(
				"SELECT * FROM symbols WHERE name LIKE ? ESCAPE '\\' ORDER BY name, file, line LIMIT ?",
			),

			getFile: this.db.prepare("SELECT * FROM files WHERE path = ?"),

			getAllFiles: this.db.prepare("SELECT path, hash FROM files"),

			getStats: this.db.prepare(
				"SELECT COUNT(DISTINCT file) as fileCount, COUNT(*) as symbolCount FROM symbols",
			),

			setMeta: this.db.prepare(
				"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			),

			getMeta: this.db.prepare("SELECT value FROM meta WHERE key = ?"),

			countByName: this.db.prepare(
				"SELECT COUNT(*) as count FROM symbols WHERE name = ?",
			),

			insertEdge: this.db.prepare(`
				INSERT INTO edges (source_file, source_symbol, target_file, target_symbol, relationship, line, raw_source)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`),

			deleteEdgesByFile: this.db.prepare(
				"DELETE FROM edges WHERE source_file = ?",
			),

			findEdgesBySourceFile: this.db.prepare(
				"SELECT * FROM edges WHERE source_file = ? ORDER BY line",
			),

			findEdgesByTargetFile: this.db.prepare(
				"SELECT * FROM edges WHERE target_file = ? ORDER BY source_file, line",
			),

			findEdgesByTargetSymbol: this.db.prepare(
				"SELECT * FROM edges WHERE target_symbol = ? AND relationship = ? ORDER BY source_file, line",
			),

			findEdgesBySourceFileAndSymbol: this.db.prepare(
				"SELECT * FROM edges WHERE source_file = ? AND source_symbol = ? ORDER BY line",
			),

			findEdgesByTargetFileAndRel: this.db.prepare(
				"SELECT * FROM edges WHERE target_file = ? AND relationship = ? ORDER BY source_file, line",
			),
		};
	}

	// ---- File operations ----

	upsertFile(rec: {
		path: string;
		language: string;
		hash: string;
		symbolCount: number;
	}) {
		this.stmts.upsertFile.run(
			rec.path,
			rec.language,
			rec.hash,
			Date.now(),
			rec.symbolCount,
		);
	}

	deleteFile(filePath: string) {
		this.stmts.deleteSymbolsByFile.run(filePath);
		this.stmts.deleteEdgesByFile.run(filePath);
		this.stmts.deleteFtsByFile.run(filePath);
		this.stmts.deleteContentLinesByFile.run(filePath);
		this.stmts.deleteFile.run(filePath);
	}

	/**
	 * Clear all indexed data (symbols, files, content, meta).
	 */
	clearAll() {
		this.db.exec("DELETE FROM symbols; DELETE FROM edges; DELETE FROM files; DELETE FROM content_fts; DELETE FROM content_lines; DELETE FROM meta;");
	}

	getFile(filePath: string): FileRecord | undefined {
		return this.stmts.getFile.get(filePath) as FileRecord | undefined;
	}

	getAllFiles(): { path: string; hash: string }[] {
		return this.stmts.getAllFiles.all() as { path: string; hash: string }[];
	}

	getAllFilesWithMeta(): { path: string; hash: string; lastIndexedAt: number }[] {
		return this.stmts.getAllFilesWithMeta.all() as { path: string; hash: string; lastIndexedAt: number }[];
	}

	// ---- Symbol operations ----

	/**
	 * Replace all symbols and edges for a file within a transaction.
	 * Calls `upsertFile` internally.
	 */
	indexFile(
		filePath: string,
		language: string,
		hash: string,
		symbols: Omit<SymbolRecord, "id">[],
		edges?: Omit<EdgeRecord, "id">[],
	) {
		const tx = this.db.transaction(() => {
			this.stmts.deleteSymbolsByFile.run(filePath);
			this.stmts.deleteEdgesByFile.run(filePath);
			for (const sym of symbols) {
				this.stmts.insertSymbol.run(
					sym.file,
					sym.name,
					sym.kind,
					sym.line,
					sym.column,
					sym.endLine,
					sym.endColumn,
					sym.signature,
					sym.scope,
					sym.visibility,
					sym.documentation,
					sym.parentId,
				);
			}
			for (const edge of (edges ?? [])) {
				this.stmts.insertEdge.run(
					edge.sourceFile,
					edge.sourceSymbol,
					edge.targetFile,
					edge.targetSymbol,
					edge.relationship,
					edge.line,
					edge.rawSource,
				);
			}
			this.upsertFile({ path: filePath, language, hash, symbolCount: symbols.length });
		});
		tx();
	}

	findDefinitions(name: string): SymbolRecord[] {
		return toSymbolRecords(this.stmts.findByName.all(name));
	}

	findDefinitionsInFile(name: string, file: string): SymbolRecord[] {
		return toSymbolRecords(this.stmts.findByNameAndFile.all(name, file));
	}

	findSymbolsInFile(file: string): SymbolRecord[] {
		return toSymbolRecords(this.stmts.findByFile.all(file));
	}

	findByKind(kind: string, limit: number): SymbolRecord[] {
		return toSymbolRecords(this.stmts.findByKind.all(kind, limit));
	}

	searchSymbols(prefix: string, limit: number): SymbolRecord[] {
		const escaped = prefix.replace(/[%_\\]/g, "\\$&");
		return toSymbolRecords(this.stmts.searchByName.all(`${escaped}%`, limit));
	}

	countDefinitions(name: string): number {
		const row = this.stmts.countByName.get(name) as { count: number };
		return row.count;
	}

	getStats(): { fileCount: number; symbolCount: number } {
		return this.stmts.getStats.get() as { fileCount: number; symbolCount: number };
	}

	// ---- Context helpers ----

	/**
	 * Get the best-matching symbol definition for fetch_context.
	 * Prefers same-file matches, then falls back to best match.
	 */
	getBestDefinition(name: string, contextFile?: string): SymbolRecord | undefined {
		if (contextFile) {
			const sameFile = toSymbolRecords(this.stmts.findByNameAndFileBest.all(name, contextFile));
			if (sameFile.length > 0) return sameFile[0];
		}
		const rows = toSymbolRecords(this.stmts.findBestDefinition.all(name));
		return rows[0];
	}

	/**
	 * Find all members of a scope in a file (e.g., methods of a class).
	 */
	findMembersOfScope(file: string, scope: string): SymbolRecord[] {
		return toSymbolRecords(this.stmts.findMembersOfScope.all(file, scope));
	}

	// ---- Edge operations ----

	/** Find all edges originating from a source file (what it depends on). */
	findEdgesFromSource(sourceFile: string): EdgeRecord[] {
		return toEdgeRecords(this.stmts.findEdgesBySourceFile.all(sourceFile));
	}

	/** Find all edges targeting a file (who depends on it). */
	findEdgesToTarget(targetFile: string): EdgeRecord[] {
		return toEdgeRecords(this.stmts.findEdgesByTargetFile.all(targetFile));
	}

	/** Find edges targeting a specific symbol name with a given relationship (e.g., "extends BaseService"). */
	findEdgesToSymbol(targetSymbol: string, relationship: string): EdgeRecord[] {
		return toEdgeRecords(this.stmts.findEdgesByTargetSymbol.all(targetSymbol, relationship));
	}

	/** Find edges from a file for a specific source symbol (e.g., class X extends/implements). */
	findEdgesFromSourceSymbol(sourceFile: string, sourceSymbol: string): EdgeRecord[] {
		return toEdgeRecords(this.stmts.findEdgesBySourceFileAndSymbol.all(sourceFile, sourceSymbol));
	}

	/** Find edges targeting a file filtered by relationship type. */
	findEdgesToTargetByRel(targetFile: string, relationship: string): EdgeRecord[] {
		return toEdgeRecords(this.stmts.findEdgesByTargetFileAndRel.all(targetFile, relationship));
	}

	// ---- FTS operations ----

	/**
	 * Index file content into FTS5 with pre-processed (camelCase-split) text
	 * and a line-map table for resolving offsets back to line numbers.
	 */
	indexFileContent(filePath: string, originalContent: string, processedContent: string) {
		const tx = this.db.transaction(() => {
			this.stmts.deleteFtsByFile.run(filePath);
			this.stmts.deleteContentLinesByFile.run(filePath);

			// Insert processed content into FTS
			this.stmts.insertFtsContent.run(filePath, processedContent);

			// Build line map from original content
			const lines = originalContent.split("\n");
			let offset = 0;
			for (let i = 0; i < lines.length; i++) {
				this.stmts.insertContentLine.run(filePath, i + 1, offset, lines[i]);
				offset += lines[i].length + 1; // +1 for newline
			}
		});
		tx();
	}

	/**
	 * Search FTS5 content. Returns raw path + rank pairs.
	 * The caller resolves offsets to lines and attaches symbol metadata.
	 */
	searchContentFts(query: string, limit: number): { path: string; rank: number }[] {
		return this.stmts.searchContent.all(query, limit) as { path: string; rank: number }[];
	}

	/**
	 * Count total files matching an FTS query (without fetching content).
	 */
	countContentFts(query: string): number {
		const row = this.stmts.searchContentCount.get(query) as { count: number };
		return row.count;
	}

	/**
	 * Check whether this file currently has an FTS row.
	 */
	hasIndexedContent(filePath: string): boolean {
		return !!this.stmts.hasFtsByFile.get(filePath);
	}

	/**
	 * Get indexed content lines for a file.
	 */
	getContentLines(filePath: string): { line_number: number; line_text: string }[] {
		return this.stmts.getContentLinesByFile.all(filePath) as { line_number: number; line_text: string }[];
	}

	/**
	 * Resolve a character offset to a line number for a given file.
	 */
	getLineByOffset(filePath: string, charOffset: number): { line_number: number; line_text: string } | undefined {
		return this.stmts.getLineByOffset.get(filePath, charOffset) as { line_number: number; line_text: string } | undefined;
	}

	/**
	 * Get all tracked files with their hashes for staleness checking.
	 */
	getAllTrackedFiles(): { path: string; hash: string }[] {
		return this.stmts.getStaleFiles.all() as { path: string; hash: string }[];
	}

	/**
	 * Find which symbol (if any) encloses a given line in a file.
	 */
	findEnclosingSymbol(file: string, line: number): SymbolRecord | undefined {
		const syms = this.findSymbolsInFile(file);
		for (const sym of syms) {
			if (line >= sym.line && line <= sym.endLine) {
				return sym;
			}
		}
		return undefined;
	}

	// ---- Meta ----

	setMeta(key: string, value: string) {
		this.stmts.setMeta.run(key, value);
	}

	getMeta(key: string): string | undefined {
		const row = this.stmts.getMeta.get(key) as { value: string } | undefined;
		return row?.value;
	}

	// ---- Lifecycle ----

	close() {
		this.db.close();
	}
}
