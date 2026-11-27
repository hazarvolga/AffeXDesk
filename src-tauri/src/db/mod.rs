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
