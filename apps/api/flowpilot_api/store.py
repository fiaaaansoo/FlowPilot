"""SQLite persistence: episodic memory of verified corrections, and recovery telemetry.

Memory stores *element descriptions*, never field values or page HTML:
the recorded target, the element that was used instead, the strategy, the scope
(origin, workflow, step) and usage counters. A correction is written only when
the extension reports that the recovered step *and its outcome* were verified.

Retrieval is plain indexed lookup (no embeddings): exact scope first, then the
same target on the same origin in another workflow. A stored correction is only
a hint until it matches exactly one element of the current page.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .contracts import Candidate, ElementTarget

SCHEMA = """
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  target_fp TEXT NOT NULL,
  failure_code TEXT NOT NULL,
  original_json TEXT NOT NULL,
  corrected_json TEXT NOT NULL,
  strategy TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (origin, workflow_id, step_id, target_fp)
);
CREATE INDEX IF NOT EXISTS corrections_by_target ON corrections (origin, target_fp);

CREATE TABLE IF NOT EXISTS recoveries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_kind TEXT NOT NULL,
  failure_code TEXT NOT NULL,
  decision TEXT NOT NULL,
  strategy TEXT NOT NULL,
  confidence REAL,
  requires_confirmation INTEGER,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  model_calls INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  context_elements INTEGER NOT NULL,
  compatible_elements INTEGER NOT NULL,
  original_json TEXT NOT NULL,
  proposed_json TEXT,
  trace_json TEXT NOT NULL,
  outcome TEXT,
  outcome_detail TEXT
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True, slots=True)
class Correction:
    id: int
    origin: str
    workflow_id: str
    step_id: str
    failure_code: str
    original: ElementTarget
    corrected: Candidate
    strategy: str
    uses: int
    created_at: str
    last_used_at: str | None


class Store:
    def __init__(self, path: Path | str) -> None:
        self._path = str(path)
        if self._path != ":memory:":
            Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._tx() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock, self._conn:
            yield self._conn

    def close(self) -> None:
        self._conn.close()

    # --- memory -----------------------------------------------------------------

    def find_correction(self, *, origin: str, workflow_id: str, step_id: str, target_fp: str) -> Correction | None:
        """Exact scope first, then the same recorded target on the same origin (another workflow)."""
        with self._tx() as conn:
            row = (
                conn.execute(
                    "SELECT * FROM corrections WHERE origin=? AND workflow_id=? AND step_id=? AND target_fp=?",
                    (origin, workflow_id, step_id, target_fp),
                ).fetchone()
                or conn.execute(
                    "SELECT * FROM corrections WHERE origin=? AND target_fp=? ORDER BY uses DESC, id DESC LIMIT 1",
                    (origin, target_fp),
                ).fetchone()
            )
        return _correction(row) if row else None

    def save_correction(
        self,
        *,
        origin: str,
        workflow_id: str,
        step_id: str,
        target_fp: str,
        failure_code: str,
        original: ElementTarget,
        corrected: Candidate,
        strategy: str,
    ) -> int:
        corrected_json = corrected.model_dump_json(by_alias=True, exclude={"ref"})
        with self._tx() as conn:
            conn.execute(
                """INSERT INTO corrections (origin, workflow_id, step_id, target_fp, failure_code, original_json,
                                            corrected_json, strategy, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (origin, workflow_id, step_id, target_fp) DO UPDATE SET
                     corrected_json=excluded.corrected_json, strategy=excluded.strategy,
                     failure_code=excluded.failure_code, created_at=excluded.created_at, uses=0, last_used_at=NULL""",
                (
                    origin,
                    workflow_id,
                    step_id,
                    target_fp,
                    failure_code,
                    original.model_dump_json(by_alias=True),
                    corrected_json,
                    strategy,
                    _now(),
                ),
            )
            row = conn.execute(
                "SELECT id FROM corrections WHERE origin=? AND workflow_id=? AND step_id=? AND target_fp=?",
                (origin, workflow_id, step_id, target_fp),
            ).fetchone()
        return int(row["id"])

    def mark_used(self, correction_id: int) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE corrections SET uses = uses + 1, last_used_at = ? WHERE id = ?", (_now(), correction_id)
            )

    def forget(self, correction_id: int) -> bool:
        with self._tx() as conn:
            return conn.execute("DELETE FROM corrections WHERE id = ?", (correction_id,)).rowcount > 0

    def list_corrections(self, origin: str | None = None) -> list[Correction]:
        with self._tx() as conn:
            rows = (
                conn.execute("SELECT * FROM corrections WHERE origin=? ORDER BY id DESC", (origin,))
                if origin
                else conn.execute("SELECT * FROM corrections ORDER BY id DESC")
            ).fetchall()
        return [_correction(row) for row in rows]

    def clear_corrections(self, origin: str | None = None) -> int:
        with self._tx() as conn:
            cursor = (
                conn.execute("DELETE FROM corrections WHERE origin=?", (origin,))
                if origin
                else conn.execute("DELETE FROM corrections")
            )
            return cursor.rowcount

    # --- telemetry --------------------------------------------------------------

    def record_recovery(self, row: dict[str, Any]) -> None:
        columns = ", ".join(row)
        placeholders = ", ".join("?" for _ in row)
        with self._tx() as conn:
            conn.execute(f"INSERT INTO recoveries ({columns}) VALUES ({placeholders})", tuple(row.values()))  # noqa: S608 - column names are code constants

    def get_recovery(self, recovery_id: str) -> sqlite3.Row | None:
        with self._tx() as conn:
            return conn.execute("SELECT * FROM recoveries WHERE id = ?", (recovery_id,)).fetchone()

    def set_outcome(self, recovery_id: str, outcome: str, detail: str) -> bool:
        with self._tx() as conn:
            return (
                conn.execute(
                    "UPDATE recoveries SET outcome=?, outcome_detail=? WHERE id=? AND outcome IS NULL",
                    (outcome, detail, recovery_id),
                ).rowcount
                > 0
            )

    def metrics(self) -> dict[str, Any]:
        with self._tx() as conn:
            rows = conn.execute(
                """SELECT strategy, decision, provider, model, outcome, COUNT(*) AS n,
                          SUM(model_calls) AS calls, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout,
                          SUM(COALESCE(cache_read_tokens, 0)) AS cread, SUM(COALESCE(cache_write_tokens, 0)) AS cwrite,
                          AVG(latency_ms) AS latency, SUM(cost_usd) AS cost
                   FROM recoveries GROUP BY strategy, decision, provider, model, outcome"""
            ).fetchall()
            memory = conn.execute("SELECT COUNT(*) AS n, SUM(uses) AS uses FROM corrections").fetchone()
        groups = [dict(row) for row in rows]
        total = sum(g["n"] for g in groups)
        proposed = [g for g in groups if g["decision"] == "propose_target"]
        verified = sum(g["n"] for g in proposed if g["outcome"] == "verified")
        failed = sum(g["n"] for g in proposed if g["outcome"] in {"failed", "rejected"})
        return {
            "recoveries": total,
            "proposals": sum(g["n"] for g in proposed),
            "escalations": sum(g["n"] for g in groups if g["decision"] == "escalate"),
            "verified": verified,
            "incorrectOrRejected": failed,
            "memoryReuses": sum(g["n"] for g in proposed if g["strategy"] == "memory"),
            "modelCalls": sum(g["calls"] or 0 for g in groups),
            "inputTokens": sum(g["tin"] or 0 for g in groups),
            "outputTokens": sum(g["tout"] or 0 for g in groups),
            "cacheReadTokens": sum(g["cread"] or 0 for g in groups),
            "cacheWriteTokens": sum(g["cwrite"] or 0 for g in groups),
            "estimatedCostUsd": round(sum(g["cost"] or 0 for g in groups), 6),
            "memoryEntries": memory["n"] or 0,
            "groups": groups,
        }


def _correction(row: sqlite3.Row) -> Correction:
    corrected = json.loads(row["corrected_json"])
    corrected["ref"] = "e0"
    return Correction(
        id=row["id"],
        origin=row["origin"],
        workflow_id=row["workflow_id"],
        step_id=row["step_id"],
        failure_code=row["failure_code"],
        original=ElementTarget.model_validate_json(row["original_json"]),
        corrected=Candidate.model_validate(corrected),
        strategy=row["strategy"],
        uses=row["uses"],
        created_at=row["created_at"],
        last_used_at=row["last_used_at"],
    )
