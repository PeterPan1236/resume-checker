// Local stand-in for a D1 binding, backed by node:sqlite. It implements only
// the slice of the D1 API that lib/store.js uses — prepare().bind().run/first/all
// and exec() — so identical SQL runs against a file on disk in development and
// against D1 in the Worker.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

class LocalStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new LocalStatement(this.db, this.sql, params);
  }

  async run() {
    const out = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(out.changes), last_row_id: Number(out.lastInsertRowid) } };
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    return column === undefined ? row : row[column];
  }

  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.params) };
  }
}

class LocalD1 {
  constructor(filename) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  prepare(sql) {
    return new LocalStatement(this.db, sql);
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  async batch(statements) {
    const out = [];
    for (const stmt of statements) out.push(await stmt.run());
    return out;
  }
}

export function openLocalD1(filename) {
  return new LocalD1(filename);
}
