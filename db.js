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

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

/**
 * 增量迁移：为旧版本数据库补充新列 / 新表。
 * CREATE TABLE IF NOT EXISTS 不会补列，必须用 PRAGMA + ALTER TABLE。
 * 注意：SQLite 的 ALTER TABLE ADD COLUMN 不允许非恒定默认值（如 datetime('now')），
 * 因此迁移时一律不加默认值；调度器写入时会显式赋值。
 */
function migrate() {
  const migrations = [
    { table: 'projects', column: 'is_default',      sql: 'ALTER TABLE projects ADD COLUMN is_default INTEGER DEFAULT 0' },
    { table: 'projects', column: 'last_balance',    sql: 'ALTER TABLE projects ADD COLUMN last_balance REAL' },
    { table: 'projects', column: 'last_fetched_at', sql: 'ALTER TABLE projects ADD COLUMN last_fetched_at TEXT' },
    { table: 'projects', column: 'last_error',      sql: 'ALTER TABLE projects ADD COLUMN last_error TEXT' },
    // 多用户：数据按 user_id 隔离
    { table: 'projects',         column: 'user_id', sql: 'ALTER TABLE projects ADD COLUMN user_id INTEGER' },
    { table: 'global_snapshots', column: 'user_id', sql: 'ALTER TABLE global_snapshots ADD COLUMN user_id INTEGER' },
    { table: 'alerts',           column: 'user_id', sql: 'ALTER TABLE alerts ADD COLUMN user_id INTEGER' },
    { table: 'usage_snapshots',  column: 'user_id', sql: 'ALTER TABLE usage_snapshots ADD COLUMN user_id INTEGER' }
  ];

  for (const m of migrations) {
    if (hasColumn(m.table, m.column)) continue;
    try {
      db.exec(m.sql);
      console.log(`[DB] 迁移: ${m.table} 新增列 ${m.column}`);
    } catch (err) {
      console.warn(`[DB] 迁移跳过 ${m.table}.${m.column}: ${err.message}`);
    }
  }

  // usage_snapshots 原 UNIQUE(date, model, source) 是全局唯一的，
  // 多用户下会互相冲突。若该表已存在但唯一约束未含 user_id，则重建表。
  // （该表是“派生数据”，每次轮询会重新写入，重建无数据损失。）
  if (hasColumn('usage_snapshots', 'user_id')) {
    const uniq = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'sqlite_autoindex_usage_snapshots_1'
    `).get();
    if (uniq && /\(date, model, source\)/.test(uniq.sql)) {
      try {
        db.exec(`
          DROP TABLE IF EXISTS usage_snapshots;
          CREATE TABLE usage_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            date TEXT NOT NULL,
            model TEXT NOT NULL,
            requests INTEGER,
            tokens INTEGER,
            cost REAL NOT NULL,
            source TEXT DEFAULT 'api',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, date, model, source)
          );
        `);
        console.log('[DB] 迁移: 重建 usage_snapshots（唯一约束加入 user_id）');
      } catch (err) {
        console.warn(`[DB] usage_snapshots 重建失败: ${err.message}`);
      }
    }
  }
}

function initTables() {
  const sql = `
    -- 登录系统：用户与 Session
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      personal_info TEXT,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- Web Push（锁屏推送）订阅，按用户隔离
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      balance_threshold REAL DEFAULT 10.0,
      rate_threshold REAL DEFAULT 5.0,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      last_balance REAL,
      last_fetched_at TEXT DEFAULT (datetime('now')),
      last_error TEXT,
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

    -- 模块二：用量明细（来自 DEEPSEEK_USAGE_ENDPOINT 适配器）
    -- 未配置适配器时，由余额快照推导出的每日消费以 model='全部', source='derived' 写入
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      requests INTEGER,
      tokens INTEGER,
      cost REAL NOT NULL,
      source TEXT DEFAULT 'api',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, model, source)
    );

    -- 模块八：邮件发送日志（用于 24h 去重，避免每小时重复轰炸）
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      type TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project_fetched
    ON snapshots(project_id, fetched_at DESC);

    CREATE INDEX IF NOT EXISTS idx_global_snapshots_fetched
    ON global_snapshots(fetched_at DESC);

    CREATE INDEX IF NOT EXISTS idx_usage_date
    ON usage_snapshots(date);

    CREATE INDEX IF NOT EXISTS idx_email_logs_project
    ON email_logs(project_id, sent_at DESC);
  `;

  try {
    db.exec(sql);
    migrate();
    console.log('[DB] 数据库表初始化 + 迁移完成');
  } catch (err) {
    console.error('[DB] 建表失败:', err.message);
    process.exit(1);
  }
}

initTables();

module.exports = db;
