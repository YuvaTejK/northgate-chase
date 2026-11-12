from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from assistant.app.auth import (
    SessionUser,
    clear_session_cookie,
    current_user,
    set_session_cookie,
)
from assistant.app.config import Settings, settings
from assistant.app.gemini import GeminiService
from assistant.app.repository import CaseRepository
from assistant.app.service import AssistantService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("northgate.assistant.api")


class DemoLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    persona_id: str = Field(min_length=1, max_length=160)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1200)


def create_app(
    *,
    app_settings: Settings | None = None,
    repository: CaseRepository | None = None,
    gemini: GeminiService | None = None,
) -> FastAPI:
    config = app_settings or settings
    data = repository or CaseRepository(config.database_path)
    model = gemini or GeminiService(config)
    assistant_service = AssistantService(data, model, config)
    recent_requests: dict[str, deque[float]] = defaultdict(deque)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        data.ensure_audit_migration()
        yield

    application = FastAPI(
        title="Northgate Chase Assistant",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.settings = config
    application.state.repository = data
    application.state.assistant = assistant_service

    @application.get("/api/assistant/health")
    async def assistant_health():
        return {
            "status": "ok",
            "geminiConfigured": config.gemini_configured,
            "model": config.gemini_model,
            "provider": "vertex-ai" if config.vertex_ai_enabled else "gemini-api",
            "mode": "synthetic-data",
        }

    @application.get("/api/auth/personas")
    async def personas():
        return {"personas": data.personas(), "demoOnly": True}

    @application.post("/api/auth/demo")
    async def demo_login(payload: DemoLoginRequest, response: Response):
        if not config.demo_auth_enabled:
            raise HTTPException(status_code=404, detail="Demo sign-in is disabled.")
        user = data.validate_persona(payload.persona_id)
        set_session_cookie(response, user, config)
        return {
            "user": {
                "name": user.name,
                "role": user.role,
                "defaultCaseId": data.default_reminder_case_id(user),
            },
            "demoOnly": True,
        }

    @application.get("/api/auth/me")
    async def me(user: Annotated[SessionUser, Depends(current_user)]):
        return {
            "user": {
                "name": user.name,
                "role": user.role,
                "defaultCaseId": data.default_reminder_case_id(user),
            },
            "demoOnly": True,
        }

    @application.post("/api/auth/logout")
    async def logout(response: Response):
        clear_session_cookie(response)
        return {"ok": True}

    @application.post("/api/assistant/chat")
    async def chat(
        payload: ChatRequest,
        request: Request,
        user: Annotated[SessionUser, Depends(current_user)],
    ):
        now = time.monotonic()
        user_key = f"{user.role}:{user.name}"
        window = recent_requests[user_key]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= 20:
            raise HTTPException(status_code=429, detail="Assistant rate limit reached. Wait a minute and try again.")
        window.append(now)

        question = payload.question.strip()
        if not question:
            raise HTTPException(status_code=422, detail="Enter a question for the assistant.")
        service: AssistantService = request.app.state.assistant
        result = await service.answer(question, user)
        logger.info(
            "Assistant completed request_id=%s role=%s intent=%s sources=%s",
            result["requestId"],
            user.role,
            result["intent"],
            len(result["sources"]),
        )
        return result

    return application


app = create_app()
