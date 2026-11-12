from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from assistant.app.config import Settings
from assistant.app.gemini import GeminiService


def test_vertex_ai_client_uses_project_location_and_adc(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    constructor = Mock(return_value=client)
    monkeypatch.setattr("google.genai.Client", constructor)
    settings = Settings(
        database_path=Path("test.sqlite"),
        gemini_api_key=None,
        gemini_model="gemini-3-flash-preview",
        session_secret="test-session-secret",
        session_ttl_seconds=3600,
        gemini_timeout_seconds=1,
        demo_auth_enabled=True,
        gcp_project_id="synthetic-demo-project",
        vertex_ai_enabled=True,
        vertex_ai_location="global",
    )

    assert GeminiService(settings)._get_client() is client
    kwargs = constructor.call_args.kwargs
    assert kwargs["vertexai"] is True
    assert kwargs["project"] == "synthetic-demo-project"
    assert kwargs["location"] == "global"
    assert "api_key" not in kwargs


def test_vertex_ai_requires_project_id() -> None:
    settings = Settings(
        database_path=Path("test.sqlite"),
        gemini_api_key=None,
        gemini_model="gemini-3-flash-preview",
        session_secret="test-session-secret",
        session_ttl_seconds=3600,
        gemini_timeout_seconds=1,
        demo_auth_enabled=True,
        vertex_ai_enabled=True,
    )

    with pytest.raises(RuntimeError, match="requires GCP_PROJECT_ID"):
        GeminiService(settings)._get_client()
