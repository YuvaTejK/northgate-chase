from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from assistant.app.auth import SessionUser
from assistant.app.config import PROJECT_ROOT

CASE_ID_PATTERN = re.compile(r"\bNG-2026-\d{4}\b", re.IGNORECASE)


class CaseRepository:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    def connect(self, *, read_only: bool = False) -> sqlite3.Connection:
        if read_only:
            connection = sqlite3.connect(
                f"file:{self.database_path.as_posix()}?mode=ro",
                uri=True,
                timeout=10,
            )
            connection.execute("PRAGMA query_only = ON")
        else:
            connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def ensure_audit_migration(self) -> None:
        if not self.database_path.exists():
            return
        migration_path = PROJECT_ROOT / "src" / "server" / "migrations" / "002_assistant_audit.sql"
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            applied = connection.execute(
                "SELECT version FROM schema_migrations WHERE version = 2"
            ).fetchone()
            if applied:
                return
            if not migration_path.is_file():
                raise RuntimeError("The assistant audit database migration is missing.")
            connection.executescript(migration_path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)",
                (datetime.now(timezone.utc).isoformat(),),
            )

    def personas(self) -> list[dict[str, str]]:
        with self.connect(read_only=True) as connection:
            rms = connection.execute("SELECT DISTINCT rm_name FROM cases ORDER BY rm_name").fetchall()
            analysts = connection.execute("SELECT DISTINCT analyst_name FROM cases ORDER BY analyst_name").fetchall()
        entries = [
            {"id": "ops", "name": "Claire Sterling", "role": "ops", "label": "Ops Coordinator"},
            {"id": "coo", "name": "Evelyn Hart", "role": "coo", "label": "COO · aggregate view"},
        ]
        entries.extend(
            {"id": f"rm:{row['rm_name']}", "name": row["rm_name"], "role": "relationship_manager", "label": "Relationship Manager"}
            for row in rms
        )
        entries.extend(
            {"id": f"analyst:{row['analyst_name']}", "name": row["analyst_name"], "role": "analyst", "label": "KYC Analyst"}
            for row in analysts
        )
        return entries

    def validate_persona(self, persona_id: str) -> SessionUser:
        persona = next((item for item in self.personas() if item["id"] == persona_id), None)
        if not persona:
            raise HTTPException(status_code=400, detail="Choose a valid synthetic workspace persona.")
        return SessionUser(name=persona["name"], role=persona["role"])  # type: ignore[arg-type]

    def default_reminder_case_id(self, user: SessionUser) -> str | None:
        if user.role != "relationship_manager":
            return None
        with self.connect(read_only=True) as connection:
            row = connection.execute(
                "SELECT c.id FROM cases c WHERE c.rm_name = ? AND EXISTS ("
                "SELECT 1 FROM documents d WHERE d.case_id = c.id "
                "AND d.state = 'requested' AND d.owner = 'Client') ORDER BY c.id LIMIT 1",
                (user.name,),
            ).fetchone()
        return str(row["id"]) if row else None

    def _case_scope(self, user: SessionUser, alias: str = "c") -> tuple[str, tuple[Any, ...]]:
        if user.role == "relationship_manager":
            return f"{alias}.rm_name = ?", (user.name,)
        if user.role == "analyst":
            return f"{alias}.analyst_name = ?", (user.name,)
        if user.role == "ops":
            return "1 = 1", ()
        raise HTTPException(
            status_code=403,
            detail="COO access is limited to aggregated operational analytics.",
        )

    @staticmethod
    def _requested_doc(row: sqlite3.Row, today: date) -> dict[str, Any]:
        due_date = date.fromisoformat(row["due_date"])
        request_date = date.fromisoformat(row["request_date"])
        return {
            "id": row["id"],
            "name": row["name"],
            "category": row["category"],
            "owner": row["owner"],
            "status": "Overdue" if row["state"] == "requested" and due_date < today else "Requested",
            "due_date": row["due_date"],
            "waiting_days": max(0, (today - request_date).days),
            "chase_round": row["chase_round"],
        }

    def _visible_cases(self, connection: sqlite3.Connection, user: SessionUser) -> list[dict[str, Any]]:
        scope, params = self._case_scope(user)
        rows = connection.execute(
            f"SELECT c.id, c.client_name, c.jurisdiction, c.rm_name, c.analyst_name, c.stage, c.stage_days, c.days_open "
            f"FROM cases c WHERE {scope} ORDER BY c.id",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def _find_case(
        self,
        connection: sqlite3.Connection,
        user: SessionUser,
        question: str,
    ) -> dict[str, Any] | None:
        case_match = CASE_ID_PATTERN.search(question)
        cases = self._visible_cases(connection, user)
        if case_match:
            case_id = case_match.group(0).upper()
            return next((row for row in cases if row["id"] == case_id), None)

        normalized = question.casefold()
        matches = [row for row in cases if row["client_name"].casefold() in normalized]
        if matches:
            return max(matches, key=lambda row: len(row["client_name"]))
        return None

    @staticmethod
    def _documents_for_case(
        connection: sqlite3.Connection,
        case_id: str,
        today: date,
        *,
        outstanding_only: bool = False,
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM documents WHERE case_id = ?"
        if outstanding_only:
            sql += " AND state = 'requested'"
        sql += " ORDER BY due_date, name"
        rows = connection.execute(sql, (case_id,)).fetchall()
        return [CaseRepository._requested_doc(row, today) for row in rows]

    @staticmethod
    def _source(case_id: str, label: str, source_type: str = "case") -> dict[str, str]:
        return {"id": case_id, "label": label, "type": source_type}

    def _case_facts(self, connection: sqlite3.Connection, case: dict[str, Any], today: date) -> dict[str, Any]:
        documents = self._documents_for_case(connection, case["id"], today, outstanding_only=True)
        sources = [self._source(case["id"], f"Case record · {case['id']}")]
        if documents:
            sources.append(
                self._source(
                    case["id"],
                    f"Outstanding checklist · {len(documents)} document items",
                    "documents",
                )
            )
        return {
            "case": {
                "id": case["id"],
                "client_name": case["client_name"],
                "rm_name": case["rm_name"],
                "stage": case["stage"],
            },
            "documents": documents,
            "sources": sources,
        }

    def retrieve(self, question: str, user: SessionUser) -> dict[str, Any]:
        normalized = question.casefold()
        case_id = CASE_ID_PATTERN.search(question)
        draft_request = "draft" in normalized and "reminder" in normalized
        if user.role == "coo":
            if case_id or draft_request:
                raise HTTPException(
                    status_code=403,
                    detail="COO access is limited to aggregated operational analytics, not case-level data or reminder drafts.",
                )
            return self._retrieve_aggregate(normalized, question, user)
        if draft_request and user.role != "relationship_manager":
            raise HTTPException(status_code=403, detail="Only an assigned relationship manager can create a reminder draft.")

        today = date.today()
        with self.connect(read_only=True) as connection:
            matched_case = self._find_case(connection, user, question)
            if case_id and not matched_case:
                raise HTTPException(
                    status_code=404,
                    detail="That case is not available in your authorized portfolio.",
                )
            if draft_request or (matched_case and any(word in normalized for word in ("missing", "outstanding", "summar", "document", "blocked", "ubo"))):
                if not matched_case:
                    return self._empty_result("case_detail", "I could not match that client or case to your authorized portfolio.")
                payload = self._case_facts(connection, matched_case, today)
                if "ubo" in normalized or "blocked" in normalized:
                    related = [
                        document for document in payload["documents"]
                        if document["category"] in {"Ownership and UBO", "Registry extracts"}
                    ]
                    facts = {
                        "case": payload["case"],
                        "blocking_documents": related,
                        "outstanding_documents": payload["documents"],
                    }
                    return self._result(
                        "ubo_blocker" if "ubo" in normalized or "blocked" in normalized else "case_detail",
                        facts,
                        payload["sources"],
                        case_id=matched_case["id"],
                        document_ids=[item["id"] for item in payload["documents"]],
                        is_draft=draft_request,
                        direct_answer=(
                            f"The case record labels {matched_case['id']} as “{matched_case['stage']}”. "
                            f"Outstanding ownership or registry items: "
                            f"{', '.join(document['name'] for document in related) if related else 'none recorded'}. "
                            "This describes recorded workflow dependencies only; it is not a UBO or KYC decision."
                            if "ubo" in normalized or "blocked" in normalized else None
                        ),
                        draft_context={
                            "case": payload["case"],
                            "documents": payload["documents"],
                            "due_date": (today + timedelta(days=7)).isoformat(),
                        } if draft_request else None,
                    )
                return self._result(
                    "reminder_draft" if draft_request else "case_detail",
                    payload,
                    payload["sources"],
                    case_id=matched_case["id"],
                    document_ids=[item["id"] for item in payload["documents"]],
                    is_draft=draft_request,
                    direct_answer=(
                        f"{matched_case['client_name']} has {len(payload['documents'])} outstanding requested document(s)."
                        if not draft_request else None
                    ),
                    draft_context={
                        "case": payload["case"],
                        "documents": payload["documents"],
                        "due_date": (today + timedelta(days=7)).isoformat(),
                    } if draft_request else None,
                )

            if any(word in normalized for word in ("longest", "oldest", "waiting the most", "waiting longest")):
                cases = self._visible_cases(connection, user)
                results = []
                for case in cases:
                    docs = self._documents_for_case(connection, case["id"], today, outstanding_only=True)
                    for document in docs:
                        if document["owner"] == "Client":
                            results.append({
                                "case_id": case["id"],
                                "client_name": case["client_name"],
                                "rm_name": case["rm_name"],
                                "document_name": document["name"],
                                "waiting_days": document["waiting_days"],
                                "due_date": document["due_date"],
                                "status": document["status"],
                            })
                results.sort(key=lambda item: (-item["waiting_days"], item["case_id"], item["document_name"]))
                results = results[:10]
                sources = self._unique_case_sources(results, "Oldest outstanding document records")
                return self._result(
                    "longest_waiting",
                    {"items": results, "count": len(results)},
                    sources,
                    direct_answer=f"Found {len(results)} oldest outstanding client-owned document item(s), ranked by request date.",
                )

            if "overdue" in normalized or "past due" in normalized:
                cases = self._visible_cases(connection, user)
                results = []
                for case in cases:
                    docs = self._documents_for_case(connection, case["id"], today, outstanding_only=True)
                    for document in docs:
                        if document["owner"] == "Client" and document["status"] == "Overdue":
                            results.append({
                                "case_id": case["id"],
                                "client_name": case["client_name"],
                                "rm_name": case["rm_name"],
                                "document_name": document["name"],
                                "due_date": document["due_date"],
                                "waiting_days": document["waiting_days"],
                            })
                results.sort(key=lambda item: (item["due_date"], item["case_id"]))
                sources = self._unique_case_sources(results, "Overdue document checklist")
                return self._result(
                    "overdue_documents",
                    {"items": results, "count": len(results), "as_of": today.isoformat()},
                    sources,
                    direct_answer=f"Found {len(results)} overdue client-owned document item(s), calculated from their due dates.",
                )

            if "today" in normalized and any(word in normalized for word in ("follow", "chase", "due")):
                cases = self._visible_cases(connection, user)
                results = []
                for case in cases:
                    docs = self._documents_for_case(connection, case["id"], today, outstanding_only=True)
                    for document in docs:
                        if document["owner"] == "Client" and document["due_date"] <= today.isoformat():
                            results.append({
                                "case_id": case["id"],
                                "client_name": case["client_name"],
                                "rm_name": case["rm_name"],
                                "document_name": document["name"],
                                "due_date": document["due_date"],
                                "status": document["status"],
                            })
                sources = self._unique_case_sources(results, "Due-date checklist")
                return self._result(
                    "follow_up_today",
                    {"items": results, "count": len(results), "date": today.isoformat()},
                    sources,
                    direct_answer=f"{len(results)} client-owned document item(s) have follow-up due today or earlier ({today.isoformat()}).",
                )

            if matched_case:
                payload = self._case_facts(connection, matched_case, today)
                return self._result(
                    "case_detail",
                    payload,
                    payload["sources"],
                    case_id=matched_case["id"],
                    direct_answer=f"{matched_case['client_name']} has {len(payload['documents'])} outstanding requested document(s).",
                )

        return self._empty_result(
            "unsupported",
            "I can answer questions about overdue items, longest waits, follow-up due today, missing documents, recorded UBO blockers, or a reminder draft for a case in your authorized scope.",
        )

    def _retrieve_aggregate(self, normalized: str, question: str, user: SessionUser) -> dict[str, Any]:
        today = date.today().isoformat()
        with self.connect(read_only=True) as connection:
            overdue = connection.execute(
                "SELECT COUNT(DISTINCT case_id) AS case_count, COUNT(*) AS document_count "
                "FROM documents WHERE state = 'requested' AND owner = 'Client' AND due_date < ?",
                (today,),
            ).fetchone()
            outstanding = connection.execute(
                "SELECT COUNT(*) AS document_count FROM documents WHERE state = 'requested' AND owner = 'Client'"
            ).fetchone()
            due_today = connection.execute(
                "SELECT COUNT(*) AS document_count, COUNT(DISTINCT case_id) AS case_count "
                "FROM documents WHERE state = 'requested' AND owner = 'Client' AND due_date <= ?",
                (today,),
            ).fetchone()
            blocked = connection.execute(
                "SELECT COUNT(DISTINCT c.id) AS case_count, COUNT(d.id) AS document_count "
                "FROM cases c LEFT JOIN documents d ON d.case_id = c.id "
                "AND d.state = 'requested' AND d.category = 'Ownership and UBO' "
                "WHERE c.stage = 'UBO Review Blocked'"
            ).fetchone()
            oldest = connection.execute(
                "SELECT MIN(request_date) AS oldest_request_date FROM documents "
                "WHERE state = 'requested' AND owner = 'Client'"
            ).fetchone()
        facts: dict[str, Any] = {
            "as_of": today,
            "overdue_case_count": overdue["case_count"],
            "overdue_document_count": overdue["document_count"],
            "outstanding_document_count": outstanding["document_count"],
            "follow_up_due_case_count": due_today["case_count"],
            "follow_up_due_document_count": due_today["document_count"],
            "ubo_blocked_case_count": blocked["case_count"],
            "ubo_blocking_document_count": blocked["document_count"],
            "oldest_wait_days": max(0, (date.today() - date.fromisoformat(oldest["oldest_request_date"])).days) if oldest["oldest_request_date"] else 0,
        }
        sources = [{"id": "aggregate:operational", "label": "Aggregated operational document and case records", "type": "analytics"}]
        if "overdue" in normalized or "past due" in normalized:
            intent = "aggregate_overdue"
            answer = f"The operational queue contains {facts['overdue_document_count']} overdue client-owned document item(s) across {facts['overdue_case_count']} case(s), as of {today}."
        elif "today" in normalized or "follow" in normalized or "due" in normalized:
            intent = "aggregate_follow_up"
            answer = f"{facts['follow_up_due_document_count']} client-owned item(s) across {facts['follow_up_due_case_count']} case(s) are due today or earlier, as of {today}."
        elif "ubo" in normalized or "blocked" in normalized:
            intent = "aggregate_ubo_blockers"
            answer = f"{facts['ubo_blocked_case_count']} case(s) are recorded in the UBO Review Blocked stage, with {facts['ubo_blocking_document_count']} outstanding ownership item(s). This is an aggregate workflow count, not a UBO decision."
        elif any(word in normalized for word in ("longest", "oldest", "waiting")):
            intent = "aggregate_waiting"
            answer = f"The oldest outstanding client document has been waiting {facts['oldest_wait_days']} day(s). Aggregate document count: {facts['outstanding_document_count']}."
        else:
            intent = "aggregate_summary"
            answer = f"Across the operational queue, {facts['outstanding_document_count']} client-owned documents are outstanding; {facts['overdue_document_count']} are overdue. No individual client or case details are available in the COO view."
        return self._result(intent, facts, sources, direct_answer=answer, aggregated=True)

    def create_ai_reminder(
        self,
        user: SessionUser,
        case_id: str,
        document_ids: list[str],
        subject: str,
        body: str,
        due_date: str,
    ) -> dict[str, str]:
        if user.role != "relationship_manager":
            raise HTTPException(status_code=403, detail="Only an assigned relationship manager can create a reminder draft.")
        now = datetime.now(timezone.utc).isoformat()
        reminder_id = str(uuid.uuid4())
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            case = connection.execute(
                "SELECT id, client_name, rm_name FROM cases WHERE id = ? AND rm_name = ?",
                (case_id, user.name),
            ).fetchone()
            if not case:
                raise HTTPException(status_code=404, detail="That case is not available in your authorized portfolio.")
            if not document_ids:
                raise HTTPException(status_code=409, detail="A reminder draft requires outstanding client-owned documents.")
            placeholders = ",".join("?" for _ in document_ids)
            documents = connection.execute(
                f"SELECT id FROM documents WHERE case_id = ? AND state = 'requested' AND owner = 'Client' "
                f"AND id IN ({placeholders})",
                (case_id, *document_ids),
            ).fetchall()
            if not document_ids or len(documents) != len(set(document_ids)):
                raise HTTPException(status_code=409, detail="A reminder draft requires outstanding client-owned documents.")
            connection.execute(
                "INSERT INTO reminders "
                "(id, case_id, document_ids, template_id, recipient, subject, body, due_date, status, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)",
                (
                    reminder_id,
                    case_id,
                    json.dumps(document_ids),
                    "gemini-assisted-review",
                    "corporate.contact@synthetic.example",
                    subject[:240],
                    body[:5000],
                    due_date,
                    user.name,
                    now,
                    now,
                ),
            )
            metadata = json.dumps({
                "reminderId": reminder_id,
                "documentIds": document_ids,
                "simulationOnly": True,
                "generatedWith": "Gemini",
            })
            connection.execute(
                "INSERT INTO case_events (case_id, event_type, actor, description, metadata, occurred_at) "
                "VALUES (?, 'reminder_drafted', ?, ?, ?, ?)",
                (
                    case_id,
                    user.name,
                    f"Gemini-assisted reminder draft created for {len(document_ids)} outstanding document(s); awaiting explicit RM review.",
                    metadata,
                    now,
                ),
            )
        return {
            "id": reminder_id,
            "case_id": case_id,
            "status": "pending_review",
            "subject": subject[:240],
        }

    def record_ai_audit(
        self,
        *,
        request_id: str,
        user: SessionUser,
        intent: str,
        model: str,
        outcome: str,
        source_count: int,
        answer_length: int,
        duration_ms: int,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO assistant_audit_log "
                "(request_id, actor_name, role, intent, model, outcome, source_count, answer_length, duration_ms, occurred_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    request_id,
                    user.name,
                    user.role,
                    intent,
                    model,
                    outcome,
                    source_count,
                    answer_length,
                    duration_ms,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )

    @staticmethod
    def _unique_case_sources(items: list[dict[str, Any]], label: str) -> list[dict[str, str]]:
        seen: set[str] = set()
        sources = []
        for item in items:
            case_id = item["case_id"]
            if case_id not in seen:
                seen.add(case_id)
                sources.append(CaseRepository._source(case_id, f"{label} · {case_id}", "documents"))
        return sources

    @staticmethod
    def _result(
        intent: str,
        facts: dict[str, Any],
        sources: list[dict[str, str]],
        *,
        case_id: str | None = None,
        document_ids: list[str] | None = None,
        is_draft: bool = False,
        direct_answer: str | None = None,
        draft_context: dict[str, Any] | None = None,
        aggregated: bool = False,
    ) -> dict[str, Any]:
        return {
            "intent": intent,
            "facts": facts,
            "sources": sources,
            "case_id": case_id,
            "document_ids": document_ids or [],
            "is_draft": is_draft,
            "direct_answer": direct_answer,
            "draft_context": draft_context,
            "aggregated": aggregated,
        }

    @staticmethod
    def _empty_result(intent: str, message: str) -> dict[str, Any]:
        return CaseRepository._result(intent, {"message": message}, [], direct_answer=message)
