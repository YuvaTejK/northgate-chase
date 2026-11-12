from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

from assistant.tests.conftest import sign_in


def test_chat_requires_a_signed_demo_session(assistant_client) -> None:
    client, _, _ = assistant_client
    response = client.post("/api/assistant/chat", json={"question": "Which documents are overdue?"})
    assert response.status_code == 401


def test_rm_demo_session_supplies_a_case_from_their_assigned_portfolio(assistant_client) -> None:
    client, _, _ = assistant_client
    sign_in(client, "rm:Alice RM")
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["user"]["defaultCaseId"] == "NG-2026-1001"


def test_relationship_manager_retrieval_is_limited_to_assigned_cases(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "rm:Alice RM")
    response = client.post(
        "/api/assistant/chat",
        json={"question": "What documents are missing for case NG-2026-1001?"},
    )
    assert response.status_code == 200
    assert response.json()["sources"] == [
        {"id": "NG-2026-1001", "label": "Case record · NG-2026-1001", "type": "case"},
        {"id": "NG-2026-1001", "label": "Outstanding checklist · 1 document items", "type": "documents"},
    ]
    assert "DOC-2" not in repr(gemini.calls[0]["facts"])
    assert "sources" not in gemini.calls[0]["facts"]

    denied = client.post(
        "/api/assistant/chat",
        json={"question": "What documents are missing for case NG-2026-1002?"},
    )
    assert denied.status_code == 404
    assert "not available" in denied.json()["detail"]


def test_ops_can_retrieve_queue_facts_and_backend_supplies_sources(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "ops")
    response = client.post("/api/assistant/chat", json={"question": "Which cases have overdue KYC documents?"})
    assert response.status_code == 200
    result = response.json()
    assert result["intent"] == "overdue_documents"
    assert {source["id"] for source in result["sources"]} == {"NG-2026-1001"}
    assert "NG-2026-1001" in repr(gemini.calls[0]["facts"])
    assert "NG-2026-1002" not in repr(gemini.calls[0]["facts"])


def test_coo_only_gets_aggregates_and_cannot_request_case_details(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "coo")
    response = client.post("/api/assistant/chat", json={"question": "Which cases have overdue KYC documents?"})
    assert response.status_code == 200
    result = response.json()
    assert result["aggregated"] is True
    assert "Synthetic Alpha Ltd" not in result["answer"]
    assert result["sources"][0]["id"] == "aggregate:operational"
    assert gemini.calls == []

    denied = client.post(
        "/api/assistant/chat",
        json={"question": "What documents are missing for case NG-2026-1001?"},
    )
    assert denied.status_code == 403
    assert gemini.calls == []


def test_analyst_can_only_query_cases_assigned_to_them(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "analyst:Analyst One")
    allowed = client.post(
        "/api/assistant/chat",
        json={"question": "Why is UBO blocked for case NG-2026-1001?"},
    )
    denied = client.post(
        "/api/assistant/chat",
        json={"question": "Why is UBO blocked for case NG-2026-1002?"},
    )
    assert allowed.status_code == 200
    assert "not a UBO or KYC decision" in allowed.json()["answer"]
    assert "Official Company Registry Extract" in allowed.json()["answer"]
    assert gemini.calls == []
    assert denied.status_code == 404


def test_gemini_reminder_is_saved_pending_and_never_approved_or_sent(assistant_client) -> None:
    client, gemini, database_path = assistant_client
    sign_in(client, "rm:Alice RM")
    response = client.post(
        "/api/assistant/chat",
        json={"question": "Draft a reminder for the missing documents in case NG-2026-1001"},
    )
    assert response.status_code == 200
    reminder = response.json()["reminderDraft"]
    assert reminder["status"] == "pending_review"
    assert response.json()["sources"][-1]["type"] == "reminder"
    assert "not been approved or sent" in response.json()["answer"]
    assert gemini.calls[0]["intent"] == "reminder_draft"
    assert gemini.calls[0]["facts"] == {
        "client_name": "Synthetic Alpha Ltd",
        "outstanding_documents": [{"name": "Official Company Registry Extract", "category": "Registry extracts"}],
    }
    assert gemini.calls[0]["draft_context"]["due_date"]

    with sqlite3.connect(database_path) as connection:
        record = connection.execute(
            "SELECT status, approved_by, simulated_sent_at, template_id FROM reminders WHERE id = ?",
            (reminder["id"],),
        ).fetchone()
        event = connection.execute(
            "SELECT event_type, actor FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            ("NG-2026-1001",),
        ).fetchone()
    assert record == ("pending_review", None, None, "gemini-assisted-review")
    assert event == ("reminder_drafted", "Alice RM")


def test_audit_stores_metadata_not_raw_question_or_answer(assistant_client) -> None:
    client, _, database_path = assistant_client
    sign_in(client, "ops")
    client.post("/api/assistant/chat", json={"question": "Which cases have overdue KYC documents?"})
    with sqlite3.connect(database_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(assistant_audit_log)")}
        record = connection.execute(
            "SELECT role, intent, model, outcome, source_count, answer_length FROM assistant_audit_log"
        ).fetchone()
    assert "question" not in columns
    assert "response" not in columns
    assert record == ("ops", "overdue_documents", "gemini-test", "success", 1, len("Verified facts from the authorized synthetic case records."))


def test_gemini_timeout_returns_clear_gateway_timeout(assistant_client) -> None:
    client, gemini, _ = assistant_client

    async def timeout(**_: Any):
        raise TimeoutError()

    gemini.answer = timeout  # type: ignore[method-assign]
    sign_in(client, "ops")
    response = client.post("/api/assistant/chat", json={"question": "Which cases have overdue documents?"})
    assert response.status_code == 504
    assert response.json()["detail"] == "Gemini timed out. Please try again."


def test_reminder_draft_is_denied_to_ops_before_gemini(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "ops")
    response = client.post(
        "/api/assistant/chat",
        json={"question": "Draft a reminder for missing documents in case NG-2026-1001"},
    )
    assert response.status_code == 403
    assert gemini.calls == []


def test_follow_up_today_uses_database_due_dates(assistant_client) -> None:
    client, gemini, _ = assistant_client
    sign_in(client, "ops")
    response = client.post("/api/assistant/chat", json={"question": "Which cases require RM follow-up today?"})
    assert response.status_code == 200
    facts = gemini.calls[0]["facts"]
    assert facts["date"] == date.today().isoformat()
    assert {item["case_id"] for item in facts["items"]} == {"NG-2026-1001"}
