from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from assistant.app.config import PROJECT_ROOT, Settings
from assistant.app.gemini import GroundedResponse, ReminderDraftContent
from assistant.app.main import create_app
from assistant.app.repository import CaseRepository


@dataclass
class FakeGemini:
    calls: list[dict[str, Any]]
    error: Exception | None = None

    async def answer(self, **kwargs: Any) -> GroundedResponse:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        if kwargs["intent"] == "reminder_draft":
            return GroundedResponse(
                answer="I prepared an editable draft from the outstanding synthetic items.",
                reminder_draft=ReminderDraftContent(
                    subject="Synthetic document follow-up",
                    body="Hello,\n\nPlease share the synthetic registry extract by the requested date.\n\nThank you.",
                ),
            )
        return GroundedResponse(answer="Verified facts from the authorized synthetic case records.")


def create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
    connection.executescript(
        (PROJECT_ROOT / "src" / "server" / "migrations" / "001_initial.sql").read_text(encoding="utf-8")
    )
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
        (date.today().isoformat(),),
    )
    cases = [
        ("NG-2026-1001", "Synthetic Alpha Ltd", "Alpha Legal Ltd", "United Kingdom", "Alice RM", "alice@synthetic.example", "Analyst One", "Chasing Documents", 12, 24),
        ("NG-2026-1002", "Synthetic Beta GmbH", "Beta Legal GmbH", "Germany", "Bob RM", "bob@synthetic.example", "Analyst Two", "UBO Review Blocked", 9, 18),
    ]
    for index, row in enumerate(cases):
        case_id, name, entity, jurisdiction, rm, email, analyst, stage, stage_days, days_open = row
        created_at = (date.today() - timedelta(days=days_open)).isoformat() + "T09:00:00+00:00"
        connection.execute(
            "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (case_id, name, entity, jurisdiction, rm, email, analyst, stage, stage_days, days_open, created_at),
        )
        request_date = (date.today() - timedelta(days=12 if index == 0 else 4)).isoformat()
        due_date = (date.today() - timedelta(days=2) if index == 0 else date.today() + timedelta(days=2)).isoformat()
        connection.execute(
            "INSERT INTO documents "
            "(id, case_id, name, category, owner, state, request_date, due_date, chase_round) "
            "VALUES (?, ?, ?, ?, 'Client', 'requested', ?, ?, 1)",
            (f"DOC-{index + 1}", case_id, "Official Company Registry Extract", "Registry extracts", request_date, due_date),
        )
        connection.execute(
            "INSERT INTO case_events (case_id, event_type, actor, description, occurred_at) VALUES (?, ?, ?, ?, ?)",
            (case_id, "document_requested", rm, "Synthetic registry extract requested.", created_at),
        )
    connection.commit()
    connection.close()


@pytest.fixture
def assistant_client(tmp_path: Path):
    database_path = tmp_path / "assistant-test.sqlite"
    create_database(database_path)
    app_settings = Settings(
        database_path=database_path,
        gemini_api_key="test-key-never-used",
        gemini_model="gemini-test",
        session_secret="test-session-secret",
        session_ttl_seconds=3600,
        gemini_timeout_seconds=0.5,
        demo_auth_enabled=True,
    )
    fake = FakeGemini(calls=[])
    app = create_app(
        app_settings=app_settings,
        repository=CaseRepository(database_path),
        gemini=fake,  # type: ignore[arg-type]
    )
    with TestClient(app) as client:
        yield client, fake, database_path


def sign_in(client: TestClient, persona_id: str) -> dict[str, Any]:
    response = client.post("/api/auth/demo", json={"persona_id": persona_id})
    assert response.status_code == 200
    return response.json()["user"]
