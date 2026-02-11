from __future__ import annotations

import sqlite3
from pathlib import Path

from archsync.schemas import (
    EdgeFact,
    Evidence,
    FactsSnapshot,
    InterfaceFact,
    ModuleFact,
    SymbolFact,
)


class SQLiteStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def _init_db(self) -> None:
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.executescript(
                """
                CREATE TABLE IF NOT EXISTS snapshots (
                    snapshot_id TEXT PRIMARY KEY,
                    commit_id TEXT NOT NULL,
                    repo_root TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS modules (
                    snapshot_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    language TEXT NOT NULL,
                    PRIMARY KEY (snapshot_id, id)
                );

                CREATE TABLE IF NOT EXISTS symbols (
                    snapshot_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    module_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    visibility TEXT NOT NULL,
                    line INTEGER NOT NULL,
                    PRIMARY KEY (snapshot_id, id)
                );

                CREATE TABLE IF NOT EXISTS interfaces (
                    snapshot_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    module_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    protocol TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    details TEXT NOT NULL,
                    evidence_id TEXT NOT NULL,
                    PRIMARY KEY (snapshot_id, id)
                );

                CREATE TABLE IF NOT EXISTS edges (
                    snapshot_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    src_module_id TEXT NOT NULL,
                    dst_module_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    label TEXT NOT NULL,
                    evidence_id TEXT NOT NULL,
                    interface_id TEXT,
                    PRIMARY KEY (snapshot_id, id)
                );

                CREATE TABLE IF NOT EXISTS evidences (
                    snapshot_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    line_start INTEGER NOT NULL,
                    line_end INTEGER NOT NULL,
                    parser TEXT NOT NULL,
                    PRIMARY KEY (snapshot_id, id)
                );
                """
            )
            conn.commit()

    def save_snapshot(self, snapshot: FactsSnapshot) -> None:
        with self._connect() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO snapshots(snapshot_id, commit_id, repo_root, created_at) VALUES (?, ?, ?, ?)",
                (snapshot.snapshot_id, snapshot.commit_id, snapshot.repo_root, snapshot.created_at),
            )

            cursor.execute("DELETE FROM modules WHERE snapshot_id = ?", (snapshot.snapshot_id,))
            cursor.execute("DELETE FROM symbols WHERE snapshot_id = ?", (snapshot.snapshot_id,))
            cursor.execute("DELETE FROM interfaces WHERE snapshot_id = ?", (snapshot.snapshot_id,))
            cursor.execute("DELETE FROM edges WHERE snapshot_id = ?", (snapshot.snapshot_id,))
            cursor.execute("DELETE FROM evidences WHERE snapshot_id = ?", (snapshot.snapshot_id,))

            cursor.executemany(
                "INSERT INTO modules(snapshot_id, id, name, path, language) VALUES (?, ?, ?, ?, ?)",
                [
                    (snapshot.snapshot_id, item.id, item.name, item.path, item.language)
                    for item in snapshot.modules
                ],
            )
            cursor.executemany(
                "INSERT INTO symbols(snapshot_id, id, module_id, name, kind, visibility, line) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        snapshot.snapshot_id,
                        item.id,
                        item.module_id,
                        item.name,
                        item.kind,
                        item.visibility,
                        item.line,
                    )
                    for item in snapshot.symbols
                ],
            )
            cursor.executemany(
                "INSERT INTO interfaces(snapshot_id, id, module_id, name, protocol, direction, details, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        snapshot.snapshot_id,
                        item.id,
                        item.module_id,
                        item.name,
                        item.protocol,
                        item.direction,
                        item.details,
                        item.evidence_id,
                    )
                    for item in snapshot.interfaces
                ],
            )
            cursor.executemany(
                "INSERT INTO edges(snapshot_id, id, src_module_id, dst_module_id, kind, label, evidence_id, interface_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        snapshot.snapshot_id,
                        item.id,
                        item.src_module_id,
                        item.dst_module_id,
                        item.kind,
                        item.label,
                        item.evidence_id,
                        item.interface_id,
                    )
                    for item in snapshot.edges
                ],
            )
            cursor.executemany(
                "INSERT INTO evidences(snapshot_id, id, file_path, line_start, line_end, parser) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        snapshot.snapshot_id,
                        item.id,
                        item.file_path,
                        item.line_start,
                        item.line_end,
                        item.parser,
                    )
                    for item in snapshot.evidences
                ],
            )
            conn.commit()

    def load_latest_snapshot_id(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            return row[0] if row else None

    def load_snapshot(self, snapshot_id: str) -> FactsSnapshot | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT snapshot_id, commit_id, repo_root, created_at FROM snapshots WHERE snapshot_id = ?",
                (snapshot_id,),
            ).fetchone()
            if not row:
                return None
            snapshot = FactsSnapshot(
                snapshot_id=row[0],
                commit_id=row[1],
                repo_root=row[2],
                created_at=row[3],
            )
            snapshot.modules = [
                ModuleFact(*item)
                for item in conn.execute(
                    "SELECT id, name, path, language FROM modules WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchall()
            ]
            snapshot.symbols = [
                SymbolFact(*item)
                for item in conn.execute(
                    "SELECT id, module_id, name, kind, visibility, line FROM symbols WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchall()
            ]
            snapshot.interfaces = [
                InterfaceFact(*item)
                for item in conn.execute(
                    "SELECT id, module_id, name, protocol, direction, details, evidence_id FROM interfaces WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchall()
            ]
            snapshot.edges = [
                EdgeFact(*item)
                for item in conn.execute(
                    "SELECT id, src_module_id, dst_module_id, kind, label, evidence_id, interface_id FROM edges WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchall()
            ]
            snapshot.evidences = [
                Evidence(*item)
                for item in conn.execute(
                    "SELECT id, file_path, line_start, line_end, parser FROM evidences WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchall()
            ]
            return snapshot
