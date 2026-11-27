use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub fn default_db_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("AffeXDesk").join("affexdesk.db")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectUrl {
    pub project_path: String,
    pub url: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientRecord {
    pub id: i64,
    pub name: String,
    pub contact_name: String,
    pub contact_info: String,
    pub remote_tool: String,
    pub remote_id: String,
    pub os_info: String,
    pub notes: String,
    pub last_connected_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInput {
    pub id: Option<i64>,
    pub name: String,
    pub contact_name: String,
    pub contact_info: String,
    pub remote_tool: String,
    pub remote_id: String,
    pub os_info: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientProjectRecord {
    pub id: i64,
    pub client_id: i64,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub progress_pct: i64,
    pub due_date: String,
    pub local_path: String,
    pub live_url: String,
    pub notes: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientProjectInput {
    pub id: Option<i64>,
    pub client_id: i64,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub progress_pct: i64,
    pub due_date: String,
    pub local_path: String,
    pub live_url: String,
    pub notes: String,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path_ref = path.as_ref();
        if let Some(parent) = path_ref.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        let conn = Connection::open(path_ref)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_urls (
                project_path TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                contact_name TEXT NOT NULL DEFAULT '',
                contact_info TEXT NOT NULL DEFAULT '',
                remote_tool TEXT NOT NULL DEFAULT 'rustdesk',
                remote_id TEXT NOT NULL DEFAULT '',
                os_info TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                last_connected_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS client_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                priority TEXT NOT NULL DEFAULT 'normal',
                progress_pct INTEGER NOT NULL DEFAULT 0,
                due_date TEXT NOT NULL DEFAULT '',
                local_path TEXT NOT NULL DEFAULT '',
                live_url TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn journal_mode(&self) -> Result<String> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row("PRAGMA journal_mode;", [], |row| row.get(0))
    }

    pub fn busy_timeout(&self) -> Result<i64> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row("PRAGMA busy_timeout;", [], |row| row.get(0))
    }

    // --- Workspaces CRUD ---

    pub fn add_workspace(&self, path: &str, label: &str) -> Result<Workspace> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let created_at = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO workspaces (path, label, created_at) VALUES (?1, ?2, ?3)",
            params![path, label, created_at],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Workspace {
            id,
            path: path.to_string(),
            label: label.to_string(),
            created_at,
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, path, label, created_at FROM workspaces ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                path: row.get(1)?,
                label: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_workspace(&self, id: i64) -> Result<Option<Workspace>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT id, path, label, created_at FROM workspaces WHERE id = ?1",
            params![id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    label: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()
    }

    pub fn remove_workspace(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let affected = conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // --- Project URLs CRUD ---

    pub fn set_project_url(&self, project_path: &str, url: &str) -> Result<ProjectUrl> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let updated_at = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO project_urls (project_path, url, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_path) DO UPDATE SET
                 url = excluded.url,
                 updated_at = excluded.updated_at",
            params![project_path, url, updated_at],
        )?;
        Ok(ProjectUrl {
            project_path: project_path.to_string(),
            url: url.to_string(),
            updated_at,
        })
    }

    pub fn get_project_url(&self, project_path: &str) -> Result<Option<ProjectUrl>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT project_path, url, updated_at FROM project_urls WHERE project_path = ?1",
            params![project_path],
            |row| {
                Ok(ProjectUrl {
                    project_path: row.get(0)?,
                    url: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        )
        .optional()
    }

    pub fn list_project_urls(&self) -> Result<Vec<ProjectUrl>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT project_path, url, updated_at FROM project_urls ORDER BY project_path ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectUrl {
                project_path: row.get(0)?,
                url: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_project_url(&self, project_path: &str) -> Result<bool> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let affected = conn.execute(
            "DELETE FROM project_urls WHERE project_path = ?1",
            params![project_path],
        )?;
        Ok(affected > 0)
    }

    // --- Settings CRUD ---

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "INSERT INTO settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
    }

    pub fn list_settings(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    pub fn delete_setting(&self, key: &str) -> Result<bool> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let affected = conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(affected > 0)
    }

    // --- Clients CRUD ---

    pub fn list_clients(&self) -> Result<Vec<ClientRecord>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, last_connected_at, created_at
             FROM clients
             ORDER BY COALESCE(last_connected_at, created_at) DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ClientRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                contact_name: row.get(2)?,
                contact_info: row.get(3)?,
                remote_tool: row.get(4)?,
                remote_id: row.get(5)?,
                os_info: row.get(6)?,
                notes: row.get(7)?,
                last_connected_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_client(&self, id: i64) -> Result<Option<ClientRecord>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT id, name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, last_connected_at, created_at
             FROM clients WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClientRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    contact_name: row.get(2)?,
                    contact_info: row.get(3)?,
                    remote_tool: row.get(4)?,
                    remote_id: row.get(5)?,
                    os_info: row.get(6)?,
                    notes: row.get(7)?,
                    last_connected_at: row.get(8)?,
                    created_at: row.get(9)?,
                })
            },
        )
        .optional()
    }

    pub fn save_client(&self, input: &ClientInput) -> Result<ClientRecord> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let now = Utc::now().to_rfc3339();
        let name = input.name.trim();
        let contact_name = input.contact_name.trim();
        let contact_info = input.contact_info.trim();
        let remote_tool = input.remote_tool.trim().to_ascii_lowercase();
        let remote_id = input.remote_id.trim();
        let os_info = input.os_info.trim();
        let notes = input.notes.trim();

        let id = if let Some(existing_id) = input.id {
            conn.execute(
                "UPDATE clients
                 SET name = ?1, contact_name = ?2, contact_info = ?3, remote_tool = ?4, remote_id = ?5, os_info = ?6, notes = ?7
                 WHERE id = ?8",
                params![name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, existing_id],
            )?;
            existing_id
        } else {
            conn.execute(
                "INSERT INTO clients (name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, now],
            )?;
            conn.last_insert_rowid()
        };

        conn.query_row(
            "SELECT id, name, contact_name, contact_info, remote_tool, remote_id, os_info, notes, last_connected_at, created_at
             FROM clients WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClientRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    contact_name: row.get(2)?,
                    contact_info: row.get(3)?,
                    remote_tool: row.get(4)?,
                    remote_id: row.get(5)?,
                    os_info: row.get(6)?,
                    notes: row.get(7)?,
                    last_connected_at: row.get(8)?,
                    created_at: row.get(9)?,
                })
            },
        )
    }

    pub fn touch_client_connected(&self, id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let now = Utc::now().to_rfc3339();
        let affected = conn.execute(
            "UPDATE clients SET last_connected_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(if affected > 0 { Some(now) } else { None })
    }

    pub fn delete_client(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let affected = conn.execute("DELETE FROM clients WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // --- Client Projects CRUD ---

    pub fn list_client_projects(&self) -> Result<Vec<ClientProjectRecord>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, client_id, title, status, priority, progress_pct, due_date, local_path, live_url, notes, updated_at
             FROM client_projects
             ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ClientProjectRecord {
                id: row.get(0)?,
                client_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                priority: row.get(4)?,
                progress_pct: row.get(5)?,
                due_date: row.get(6)?,
                local_path: row.get(7)?,
                live_url: row.get(8)?,
                notes: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;
        rows.collect()
    }

    pub fn save_client_project(&self, input: &ClientProjectInput) -> Result<ClientProjectRecord> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let now = Utc::now().to_rfc3339();
        let title = input.title.trim();
        let status = input.status.trim().to_ascii_lowercase();
        let priority = input.priority.trim().to_ascii_lowercase();
        let progress_pct = input.progress_pct.clamp(0, 100);
        let due_date = input.due_date.trim();
        let local_path = input.local_path.trim();
        let live_url = input.live_url.trim();
        let notes = input.notes.trim();

        let id = if let Some(existing_id) = input.id {
            conn.execute(
                "UPDATE client_projects
                 SET client_id = ?1, title = ?2, status = ?3, priority = ?4, progress_pct = ?5, due_date = ?6, local_path = ?7, live_url = ?8, notes = ?9, updated_at = ?10
                 WHERE id = ?11",
                params![
                    input.client_id,
                    title,
                    status,
                    priority,
                    progress_pct,
                    due_date,
                    local_path,
                    live_url,
                    notes,
                    now,
                    existing_id
                ],
            )?;
            existing_id
        } else {
            conn.execute(
                "INSERT INTO client_projects (client_id, title, status, priority, progress_pct, due_date, local_path, live_url, notes, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    input.client_id,
                    title,
                    status,
                    priority,
                    progress_pct,
                    due_date,
                    local_path,
                    live_url,
                    notes,
                    now
                ],
            )?;
            conn.last_insert_rowid()
        };

        conn.query_row(
            "SELECT id, client_id, title, status, priority, progress_pct, due_date, local_path, live_url, notes, updated_at
             FROM client_projects WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClientProjectRecord {
                    id: row.get(0)?,
                    client_id: row.get(1)?,
                    title: row.get(2)?,
                    status: row.get(3)?,
                    priority: row.get(4)?,
                    progress_pct: row.get(5)?,
                    due_date: row.get(6)?,
                    local_path: row.get(7)?,
                    live_url: row.get(8)?,
                    notes: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
    }

    pub fn delete_client_project(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let affected = conn.execute("DELETE FROM client_projects WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_in_memory_pragmas() {
        let db = Database::open_in_memory().expect("open in-memory db");
        assert_eq!(db.busy_timeout().expect("read busy_timeout"), 5000);
        // SQLite reports "memory" for in-memory DBs even after PRAGMA journal_mode = WAL
        let mode = db.journal_mode().expect("read journal_mode");
        assert!(mode.eq_ignore_ascii_case("memory") || mode.eq_ignore_ascii_case("wal"));
    }

    #[test]
    fn test_file_backed_wal_mode() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let db_path = std::env::temp_dir().join(format!("affexdesk_test_{unique}.sqlite3"));

        {
            let db = Database::open(&db_path).expect("open file-backed db");
            assert_eq!(db.journal_mode().expect("read journal_mode").to_lowercase(), "wal");
            assert_eq!(db.busy_timeout().expect("read busy_timeout"), 5000);
        }

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn test_workspaces_crud_and_unique_path() {
        let db = Database::open_in_memory().expect("open in-memory db");

        let ws1 = db
            .add_workspace("/workspace/alpha", "Alpha")
            .expect("add alpha");
        let ws2 = db
            .add_workspace("/workspace/beta", "Beta")
            .expect("add beta");

        // Duplicate path should violate UNIQUE constraint
        assert!(db.add_workspace("/workspace/alpha", "Alpha Dup").is_err());

        let all = db.list_workspaces().expect("list workspaces");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], ws1);
        assert_eq!(all[1], ws2);

        let fetched = db.get_workspace(ws1.id).expect("get workspace");
        assert_eq!(fetched, Some(ws1.clone()));

        assert!(db.remove_workspace(ws1.id).expect("remove workspace"));
        assert!(!db.remove_workspace(ws1.id).expect("remove missing workspace"));
        assert_eq!(db.get_workspace(ws1.id).expect("get deleted"), None);
        assert_eq!(db.list_workspaces().expect("list after delete").len(), 1);
    }

    #[test]
    fn test_project_urls_crud_and_upsert() {
        let db = Database::open_in_memory().expect("open in-memory db");

        let created = db
            .set_project_url("/workspace/alpha", "http://localhost:3000")
            .expect("set project url");
        assert_eq!(created.project_path, "/workspace/alpha");
        assert_eq!(created.url, "http://localhost:3000");

        let updated = db
            .set_project_url("/workspace/alpha", "http://localhost:5173")
            .expect("upsert project url");
        assert_eq!(updated.url, "http://localhost:5173");

        let fetched = db
            .get_project_url("/workspace/alpha")
            .expect("get project url")
            .expect("url exists");
        assert_eq!(fetched.url, "http://localhost:5173");

        db.set_project_url("/workspace/beta", "http://localhost:8080")
            .expect("set second url");
        assert_eq!(db.list_project_urls().expect("list urls").len(), 2);

        assert!(db
            .delete_project_url("/workspace/alpha")
            .expect("delete url"));
        assert!(!db
            .delete_project_url("/workspace/alpha")
            .expect("delete missing url"));
        assert_eq!(
            db.get_project_url("/workspace/alpha")
                .expect("get deleted url"),
            None
        );
    }

    #[test]
    fn test_settings_crud_and_upsert() {
        let db = Database::open_in_memory().expect("open in-memory db");

        assert_eq!(db.get_setting("theme").expect("get missing setting"), None);

        db.set_setting("theme", "dark").expect("set theme");
        assert_eq!(
            db.get_setting("theme").expect("get theme"),
            Some("dark".to_string())
        );

        db.set_setting("theme", "light").expect("update theme");
        db.set_setting("locale", "en").expect("set locale");

        let all = db.list_settings().expect("list settings");
        assert_eq!(
            all,
            vec![
                ("locale".to_string(), "en".to_string()),
                ("theme".to_string(), "light".to_string())
            ]
        );

        assert!(db.delete_setting("theme").expect("delete theme"));
        assert!(!db.delete_setting("theme").expect("delete missing theme"));
        assert_eq!(db.get_setting("theme").expect("get deleted theme"), None);
    }
}
