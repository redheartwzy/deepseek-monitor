const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db;
try {
  db = new Database(path.join(DATA_DIR, 'monitor.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  console.error('[DB] 数据库打开失败:', err.message);
  process.exit(1);
}

function initTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      balance_threshold REAL DEFAULT 10.0,
      rate_threshold REAL DEFAULT 5.0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      triggered_at TEXT DEFAULT (datetime('now')),
      acknowledged INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS global_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      balance REAL NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project_fetched
    ON snapshots(project_id, fetched_at DESC);

    CREATE INDEX IF NOT EXISTS idx_global_snapshots_fetched
    ON global_snapshots(fetched_at DESC);
  `;

  try {
    db.exec(sql);
    console.log('[DB] 数据库表初始化完成');
  } catch (err) {
    console.error('[DB] 建表失败:', err.message);
    process.exit(1);
  }
}

initTables();

module.exports = db;
