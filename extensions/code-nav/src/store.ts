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

export interface FileRecord {
	path: string;
	language: string;
	hash: string;
	lastIndexedAt: number;
	symbolCount: number;
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
		findByFile: Database.Statement;
		findByKind: Database.Statement;
		searchByName: Database.Statement;
		getFile: Database.Statement;
		getAllFiles: Database.Statement;
		getStats: Database.Statement;
		setMeta: Database.Statement;
		getMeta: Database.Statement;
		countByName: Database.Statement;
	};

	constructor(dbPath: string) {
		// Ensure directory exists
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("cache_size = -32000"); // 32MB cache

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
		this.stmts.deleteFile.run(filePath);
	}

	getFile(filePath: string): FileRecord | undefined {
		return this.stmts.getFile.get(filePath) as FileRecord | undefined;
	}

	getAllFiles(): { path: string; hash: string }[] {
		return this.stmts.getAllFiles.all() as { path: string; hash: string }[];
	}

	// ---- Symbol operations ----

	/**
	 * Replace all symbols for a file within a transaction.
	 * Calls `upsertFile` internally.
	 */
	indexFile(
		filePath: string,
		language: string,
		hash: string,
		symbols: Omit<SymbolRecord, "id">[],
	) {
		const tx = this.db.transaction(() => {
			this.stmts.deleteSymbolsByFile.run(filePath);
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
			this.upsertFile({ path: filePath, language, hash, symbolCount: symbols.length });
		});
		tx();
	}

	findDefinitions(name: string): SymbolRecord[] {
		return this.stmts.findByName.all(name) as SymbolRecord[];
	}

	findDefinitionsInFile(name: string, file: string): SymbolRecord[] {
		return this.stmts.findByNameAndFile.all(name, file) as SymbolRecord[];
	}

	findSymbolsInFile(file: string): SymbolRecord[] {
		return this.stmts.findByFile.all(file) as SymbolRecord[];
	}

	findByKind(kind: string, limit: number): SymbolRecord[] {
		return this.stmts.findByKind.all(kind, limit) as SymbolRecord[];
	}

	searchSymbols(prefix: string, limit: number): SymbolRecord[] {
		const escaped = prefix.replace(/[%_\\]/g, "\\$&");
		return this.stmts.searchByName.all(`${escaped}%`, limit) as SymbolRecord[];
	}

	countDefinitions(name: string): number {
		const row = this.stmts.countByName.get(name) as { count: number };
		return row.count;
	}

	getStats(): { fileCount: number; symbolCount: number } {
		return this.stmts.getStats.get() as { fileCount: number; symbolCount: number };
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
