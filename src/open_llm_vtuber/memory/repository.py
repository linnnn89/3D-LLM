import sqlite3
import json
import hashlib
import re
import threading
from typing import List, Optional, Tuple
from contextlib import contextmanager
import logging

from .models import (
    now_iso,
    MemoryBank,
    MemoryDraft,
    CompleteTurn,
    HistorySnippet,
    MemorySettings,
    HistoryRetrievalSettings,
)

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    """Estimate token count from UTF-8 byte length (approx 3.2 bytes per token)."""
    if not text:
        return 0
    return max(1, int(len(text.encode("utf-8")) / 3.2))


def compute_batch_digest(turns: List[CompleteTurn]) -> str:
    """Compute sha256 digest of a sequence of turns to verify integrity."""
    serialized = json.dumps(
        [
            [t.user_id, t.assistant_id, t.user_content, t.assistant_content]
            for t in turns
        ],
        sort_keys=True,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class MemoryRepository:
    """
    SQLite + FTS5 based persistent repository for character memory, checkpoints,
    dialogue turns and BM25 historical snippet retrieval.
    """

    def __init__(self, db_path: Optional[str] = None):
        if not db_path or db_path == "data/memory.sqlite":
            try:
                from ..security.storage_manager import storage_mgr
                self.db_path = str(storage_mgr.get_user_data_dir() / "memory.sqlite")
            except Exception:
                self.db_path = "data/memory.sqlite"
        else:
            self.db_path = db_path
        self._sp_counter = 0
        # The connection is created with check_same_thread=False and may be reached
        # from the event loop as well as from any worker sharing this instance, so
        # every statement is serialized through this re-entrant lock.
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self):
        cursor = self.conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL;")
        cursor.execute("PRAGMA foreign_keys = ON;")

        # 1. Memory Banks
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_banks (
                character_id TEXT PRIMARY KEY,
                body TEXT NOT NULL,
                revision INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        # 2. Checkpoints
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_checkpoints (
                character_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                last_assistant_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(character_id, session_id)
            );
        """)

        # 3. Drafts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_drafts (
                character_id TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)

        # 4. Dialogue Turns (paired user + assistant)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_turns (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                user_id TEXT NOT NULL UNIQUE,
                assistant_id TEXT NOT NULL UNIQUE,
                user_content TEXT NOT NULL,
                assistant_content TEXT NOT NULL,
                user_created_at TEXT NOT NULL,
                assistant_created_at TEXT NOT NULL
            );
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_memory_turns_lookup 
            ON memory_turns(character_id, session_id, sequence);
        """)

        # 5. FTS5 Trigram table for fast CJK/English keyword and snippet retrieval
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_turns_fts USING fts5(
                user_content,
                assistant_content,
                content='memory_turns',
                content_rowid='sequence',
                tokenize='trigram'
            );
        """)

        # 6. Triggers to keep FTS5 synchronized with memory_turns
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_memory_turns_ai AFTER INSERT ON memory_turns BEGIN
                INSERT INTO memory_turns_fts(rowid, user_content, assistant_content)
                VALUES (new.sequence, new.user_content, new.assistant_content);
            END;
        """)

        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_memory_turns_ad AFTER DELETE ON memory_turns BEGIN
                INSERT INTO memory_turns_fts(memory_turns_fts, rowid, user_content, assistant_content)
                VALUES('delete', old.sequence, old.user_content, old.assistant_content);
            END;
        """)

    @contextmanager
    def transaction(self):
        """Transaction context manager with savepoint for nested operations."""
        with self._lock:
            self._sp_counter += 1
            sp_name = f"sp_mem_{self._sp_counter}"
            cursor = self.conn.cursor()
            cursor.execute(f"SAVEPOINT {sp_name}")
            try:
                yield cursor
                cursor.execute(f"RELEASE {sp_name}")
            except Exception as e:
                cursor.execute(f"ROLLBACK TO {sp_name}")
                cursor.execute(f"RELEASE {sp_name}")
                raise e

    # --- Memory Bank Operations ---

    def read_bank(self, character_id: str) -> MemoryBank:
        """Read the memory bank for a character. Unknown characters read as an empty bank.

        Reading must not write: this is on the retrieval hot path.
        """
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute(
                "SELECT character_id, body, revision, updated_at FROM memory_banks WHERE character_id = ?",
                (character_id,),
            )
            row = cursor.fetchone()
        if row is None:
            return MemoryBank(
                character_id=character_id, body="", revision=0, updated_at=now_iso()
            )
        return MemoryBank(
            character_id=row["character_id"],
            body=row["body"],
            revision=row["revision"],
            updated_at=row["updated_at"],
        )

    def write_bank(self, character_id: str, body: str, expected_revision: Optional[int] = None) -> MemoryBank:
        """Write memory bank with optimistic locking check."""
        with self.transaction() as cur:
            bank = self.read_bank(character_id)
            if expected_revision is not None and bank.revision != expected_revision:
                raise ValueError(
                    f"MemoryBank revision conflict: expected {expected_revision}, found {bank.revision}"
                )
            new_rev = bank.revision + 1
            written = self._write_bank_row(
                cur, character_id, body, new_rev, bank.revision
            )
            if not written:
                raise ValueError(
                    f"MemoryBank revision conflict: bank changed while writing (revision {bank.revision})."
                )
            return MemoryBank(character_id=character_id, body=body, revision=new_rev, updated_at=now_iso())

    @staticmethod
    def _write_bank_row(cur, character_id: str, body: str, new_rev: int, expected_rev: int) -> bool:
        """Upsert the bank row, but only while the stored revision still matches.

        Returns False when the optimistic lock no longer holds (no row written).
        """
        cur.execute(
            """
            INSERT INTO memory_banks(character_id, body, revision, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(character_id) DO UPDATE SET
                body = excluded.body,
                revision = excluded.revision,
                updated_at = excluded.updated_at
            WHERE memory_banks.revision = ?
            """,
            (character_id, body, new_rev, now_iso(), expected_rev),
        )
        return cur.rowcount == 1

    # --- Turn & Message Operations ---

    def index_turn(
        self,
        character_id: str,
        session_id: str,
        user_id: str,
        user_content: str,
        assistant_id: str,
        assistant_content: str,
        user_created_at: Optional[str] = None,
        assistant_created_at: Optional[str] = None,
    ) -> CompleteTurn:
        """Insert a complete dialogue turn into memory_turns (automatically indexed by FTS5)."""
        u_time = user_created_at or now_iso()
        a_time = assistant_created_at or now_iso()
        with self.transaction() as cur:
            # user_id and assistant_id are both UNIQUE. Look the turn up first so an
            # already-indexed turn is returned instead of relying on lastrowid after
            # an INSERT OR IGNORE that may have been skipped.
            cur.execute(
                "SELECT * FROM memory_turns WHERE user_id = ? OR assistant_id = ? LIMIT 1",
                (user_id, assistant_id),
            )
            existing = cur.fetchone()
            if existing is not None:
                return CompleteTurn(
                    user_id=existing["user_id"],
                    assistant_id=existing["assistant_id"],
                    user_content=existing["user_content"],
                    assistant_content=existing["assistant_content"],
                    session_id=existing["session_id"],
                    character_id=existing["character_id"],
                    user_created_at=existing["user_created_at"],
                    assistant_created_at=existing["assistant_created_at"],
                    sequence=existing["sequence"],
                )

            cur.execute(
                """
                INSERT INTO memory_turns(
                    character_id, session_id, user_id, assistant_id,
                    user_content, assistant_content, user_created_at, assistant_created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    character_id,
                    session_id,
                    user_id,
                    assistant_id,
                    user_content,
                    assistant_content,
                    u_time,
                    a_time,
                ),
            )
            seq = cur.lastrowid
            return CompleteTurn(
                user_id=user_id,
                assistant_id=assistant_id,
                user_content=user_content,
                assistant_content=assistant_content,
                session_id=session_id,
                character_id=character_id,
                user_created_at=u_time,
                assistant_created_at=a_time,
                sequence=seq,
            )

    def checkpoint_sequence(self, character_id: str, session_id: str) -> int:
        """Get the sequence number of the last processed assistant turn for a session."""
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT t.sequence FROM memory_checkpoints c
                JOIN memory_turns t ON t.assistant_id = c.last_assistant_id
                    AND t.character_id = c.character_id AND t.session_id = c.session_id
                WHERE c.character_id = ? AND c.session_id = ?
                """,
                (character_id, session_id),
            )
            row = cur.fetchone()
        return row["sequence"] if row else 0

    def pending_turns(self, character_id: str, session_id: str) -> int:
        """Count how many complete turns have occurred since the last checkpoint."""
        last_seq = self.checkpoint_sequence(character_id, session_id)
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM memory_turns WHERE character_id = ? AND session_id = ? AND sequence > ?",
                (character_id, session_id, last_seq),
            )
            row = cur.fetchone()
        return row["cnt"] if row else 0

    def source_batch(
        self, character_id: str, session_id: str, settings: MemorySettings
    ) -> Optional[Tuple[List[CompleteTurn], str, str]]:
        """
        Fetch a batch of unprocessed turns for memory update.
        Returns: (turns, through_assistant_id, digest) or None if no turns available.
        """
        last_seq = self.checkpoint_sequence(character_id, session_id)
        with self._lock:
            cur = self.conn.cursor()
            if settings.send_only_new_messages:
                cur.execute(
                    """
                    SELECT * FROM memory_turns 
                    WHERE character_id = ? AND session_id = ? AND sequence > ?
                    ORDER BY sequence ASC LIMIT ?
                    """,
                    (character_id, session_id, last_seq, settings.maximum_source_user_turns),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM memory_turns 
                    WHERE character_id = ? AND session_id = ?
                    ORDER BY sequence DESC LIMIT ?
                    """,
                    (character_id, session_id, settings.maximum_source_user_turns),
                )
            rows = cur.fetchall()
        if not rows:
            return None

        # When descending, reverse to chronological order
        if not settings.send_only_new_messages:
            rows = list(reversed(rows))

        turns = [
            CompleteTurn(
                user_id=r["user_id"],
                assistant_id=r["assistant_id"],
                user_content=r["user_content"],
                assistant_content=r["assistant_content"],
                session_id=r["session_id"],
                character_id=r["character_id"],
                user_created_at=r["user_created_at"],
                assistant_created_at=r["assistant_created_at"],
                sequence=r["sequence"],
            )
            for r in rows
        ]
        through_assistant_id = turns[-1].assistant_id
        digest = compute_batch_digest(turns)
        return turns, through_assistant_id, digest

    # --- Draft Management ---

    def read_draft(self, character_id: str) -> Optional[MemoryDraft]:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("SELECT value FROM memory_drafts WHERE character_id = ?", (character_id,))
            row = cur.fetchone()
        if row:
            try:
                return MemoryDraft.from_dict(json.loads(row["value"]))
            except Exception as e:
                logger.error(f"Failed to deserialize draft for {character_id}: {e}")
        return None

    def save_draft(self, draft: MemoryDraft) -> MemoryDraft:
        with self.transaction() as cur:
            bank = self.read_bank(draft.character_id)
            if bank.revision != draft.base_revision:
                raise ValueError("Memory bank revision changed during draft generation.")
            cur.execute(
                "INSERT OR REPLACE INTO memory_drafts(character_id, value) VALUES (?, ?)",
                (draft.character_id, json.dumps(draft.to_dict())),
            )
            return draft

    def discard_draft(self, character_id: str, draft_id: Optional[str] = None):
        with self.transaction() as cur:
            current = self.read_draft(character_id)
            if current and (draft_id is None or current.id == draft_id):
                cur.execute("DELETE FROM memory_drafts WHERE character_id = ?", (character_id,))

    def _apply_draft(
        self, cur, draft: MemoryDraft, body: str, expected_revision: int
    ) -> MemoryBank:
        bank = self.read_bank(draft.character_id)
        if bank.revision != expected_revision or draft.base_revision != expected_revision:
            raise ValueError(
                f"MemoryBank revision mismatch: expected {expected_revision}, got {bank.revision}"
            )

        new_rev = expected_revision + 1
        written = self._write_bank_row(
            cur, draft.character_id, body, new_rev, expected_revision
        )
        if not written:
            raise ValueError(
                f"MemoryBank revision mismatch: bank changed while writing (expected {expected_revision})."
            )

        if draft.kind == "update" and draft.through_assistant_id and draft.session_id:
            cur.execute(
                """
                INSERT INTO memory_checkpoints(character_id, session_id, last_assistant_id, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(character_id, session_id) DO UPDATE SET
                    last_assistant_id = excluded.last_assistant_id,
                    updated_at = excluded.updated_at
                """,
                (draft.character_id, draft.session_id, draft.through_assistant_id, now_iso()),
            )

        return MemoryBank(character_id=draft.character_id, body=body, revision=new_rev, updated_at=now_iso())

    def commit_draft(
        self, character_id: str, draft_id: str, body: str, expected_revision: int
    ) -> MemoryBank:
        """Apply a memory draft to update the bank and advance the checkpoint."""
        with self.transaction() as cur:
            draft = self.read_draft(character_id)
            if not draft or draft.id != draft_id:
                raise ValueError("Draft has been removed or replaced.")
            bank = self._apply_draft(cur, draft, body, expected_revision)
            cur.execute("DELETE FROM memory_drafts WHERE character_id = ?", (character_id,))
            return bank

    def commit_generated(self, draft: MemoryDraft) -> MemoryBank:
        """Commit an automatically generated draft immediately."""
        with self.transaction() as cur:
            if self.read_draft(draft.character_id):
                raise ValueError("An uncommitted draft already exists; automatic update did not overwrite bank.")
            return self._apply_draft(cur, draft, draft.body, draft.base_revision)

    # --- Historical Retrieval (FTS5 + Trigram + BM25) ---

    def retrieve(
        self,
        character_id: str,
        session_id: str,
        query: str,
        settings: HistoryRetrievalSettings,
        excluded_ids: Optional[List[str]] = None,
    ) -> List[HistorySnippet]:
        """
        Recall relevant historical turns using SQLite FTS5 trigram full-text search
        ranked by BM25, with automatic fallback to LIKE search for short tokens.
        """
        if not settings.enabled or not query.strip():
            return []

        excluded = set(excluded_ids or [])

        # Tokenize query: split into word/CJK tokens
        raw_tokens = re.findall(r"[\w]+", query.lower(), re.UNICODE)
        needles = set()
        for token in raw_tokens:
            # Check if token contains CJK characters
            if re.search(r"[\u4e00-\u9fff\u3040-\u30ff]", token):
                chars = list(token)
                if len(chars) >= 3:
                    # Trigram decomposition
                    for i in range(len(chars) - 2):
                        needles.add("".join(chars[i : i + 3]))
                        if len(needles) >= 12:
                            break
                else:
                    needles.add(token)
            else:
                needles.add(token)
            if len(needles) >= 12:
                break

        if not needles:
            return []

        search_tokens = list(needles)[:12]
        long_tokens = [t for t in search_tokens if len(t) >= 3]

        scope_sql = " AND t.session_id = ?" if settings.scope == "current_conversation" else ""
        scope_args = [character_id, session_id] if settings.scope == "current_conversation" else [character_id]

        with self._lock:
            cur = self.conn.cursor()
            rows = []

            if long_tokens:
                # FTS5 Trigram MATCH query with BM25 score
                escaped_tokens = [t.replace('"', '""') for t in long_tokens]
                match_clause = " OR ".join(f'"{t}"' for t in escaped_tokens)
                sql = f"""
                    SELECT t.*, bm25(memory_turns_fts) AS score
                    FROM memory_turns_fts
                    JOIN memory_turns t ON t.sequence = memory_turns_fts.rowid
                    WHERE memory_turns_fts MATCH ? AND t.character_id = ? {scope_sql}
                    ORDER BY score ASC, t.sequence DESC
                    LIMIT 50
                """
                cur.execute(sql, [match_clause] + scope_args)
                rows = cur.fetchall()
            else:
                # Fallback to LIKE for tokens < 3 characters
                like_conditions = " OR ".join(
                    "(t.user_content LIKE ? OR t.assistant_content LIKE ?)" for _ in search_tokens
                )
                like_args = []
                for t in search_tokens:
                    pat = f"%{t}%"
                    like_args.extend([pat, pat])
                sql = f"""
                    SELECT t.*, 0.0 AS score
                    FROM memory_turns t
                    WHERE t.character_id = ? {scope_sql} AND ({like_conditions})
                    ORDER BY t.sequence DESC
                    LIMIT 50
                """
                cur.execute(sql, scope_args + like_args)
                rows = cur.fetchall()

        results: List[HistorySnippet] = []
        used_tokens = 0

        for r in rows:
            u_id = r["user_id"]
            a_id = r["assistant_id"]
            if u_id in excluded or a_id in excluded:
                continue

            turn = CompleteTurn(
                user_id=u_id,
                assistant_id=a_id,
                user_content=r["user_content"],
                assistant_content=r["assistant_content"],
                session_id=r["session_id"],
                character_id=r["character_id"],
                user_created_at=r["user_created_at"],
                assistant_created_at=r["assistant_created_at"],
                sequence=r["sequence"],
            )
            snippet_text = f"User: {turn.user_content}\nAssistant: {turn.assistant_content}"
            t_est = estimate_tokens(snippet_text)

            if used_tokens + t_est > settings.token_budget:
                continue

            results.append(
                HistorySnippet(
                    turn=turn,
                    token_estimate=t_est,
                    session_id=turn.session_id,
                    score=float(r["score"]) if "score" in r.keys() else 0.0,
                )
            )
            used_tokens += t_est
            if len(results) >= settings.maximum_results:
                break

        return results

    def close(self):
        """Close the SQLite connection. Safe to call more than once."""
        with self._lock:
            if self.conn is not None:
                self.conn.close()
                self.conn = None
