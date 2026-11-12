from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_path: Path
    gemini_api_key: str | None
    gemini_model: str
    session_secret: str
    session_ttl_seconds: int
    gemini_timeout_seconds: float
    demo_auth_enabled: bool
    cookie_secure: bool = False
    gcp_project_id: str | None = None
    vertex_ai_enabled: bool = False
    vertex_ai_location: str = "global"

    @property
    def gemini_configured(self) -> bool:
        if self.vertex_ai_enabled:
            return bool(self.gcp_project_id)
        return bool(self.gemini_api_key)


def load_settings() -> Settings:
    configured_secret = os.getenv("NORTHGATE_SESSION_SECRET")
    if not configured_secret or configured_secret.startswith("replace_with_"):
        configured_secret = secrets.token_urlsafe(48)
        print("NORTHGATE_SESSION_SECRET is unset; demo sessions will expire when this process restarts.")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key.startswith("replace_with_"):
        api_key = None
    project_id = os.getenv("GCP_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        project_id = None

    database_path = Path(os.getenv("DATABASE_PATH", "./data/northgate.sqlite"))
    if not database_path.is_absolute():
        database_path = PROJECT_ROOT / database_path

    return Settings(
        database_path=database_path.resolve(),
        gemini_api_key=api_key,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        session_secret=configured_secret,
        session_ttl_seconds=int(os.getenv("NORTHGATE_SESSION_TTL_SECONDS", "28800")),
        gemini_timeout_seconds=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "18")),
        demo_auth_enabled=os.getenv("NORTHGATE_DEMO_AUTH_ENABLED", "true").lower() == "true",
        cookie_secure=os.getenv("NORTHGATE_COOKIE_SECURE", "false").lower() == "true",
        gcp_project_id=project_id,
        vertex_ai_enabled=os.getenv("VERTEX_AI_ENABLED", "false").lower() == "true",
        vertex_ai_location=os.getenv("VERTEX_AI_LOCATION", "global"),
    )


settings = load_settings()
