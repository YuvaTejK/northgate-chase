from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from fastapi import HTTPException

from assistant.app.auth import SessionUser
from assistant.app.config import Settings
from assistant.app.gemini import GeminiService
from assistant.app.repository import CaseRepository

logger = logging.getLogger("northgate.assistant")


class AssistantService:
    def __init__(self, repository: CaseRepository, gemini: GeminiService, settings: Settings):
        self.repository = repository
        self.gemini = gemini
        self.settings = settings

    async def answer(self, question: str, user: SessionUser) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        context: dict[str, Any] | None = None
        outcome = "error"
        answer_length = 0
        sources: list[dict[str, str]] = []
        try:
            context = self.repository.retrieve(question, user)
            sources = context["sources"]

            if context["intent"] == "ubo_blocker" and context["direct_answer"]:
                answer = context["direct_answer"]
                outcome = "success"
                answer_length = len(answer)
                return self._response(request_id, answer, sources, context)

            if context["direct_answer"] and not context["facts"].get("items") and not context["facts"].get("case"):
                answer = context["direct_answer"]
                outcome = "success" if context["aggregated"] else "no_matching_data"
                answer_length = len(answer)
                return self._response(request_id, answer, sources, context)

            if context["intent"] == "unsupported":
                answer = context["direct_answer"] or "I could not identify a supported Northgate Chase question."
                outcome = "unsupported"
                answer_length = len(answer)
                return self._response(request_id, answer, sources, context)

            if not self.settings.gemini_api_key:
                raise HTTPException(
                    status_code=503,
                    detail="Gemini is not configured. Set GEMINI_API_KEY in the server environment and restart the assistant service.",
                )

            model_facts = {key: value for key, value in context["facts"].items() if key != "sources"}
            model_draft_context = context["draft_context"]
            if context["intent"] == "reminder_draft":
                case = context["facts"]["case"]
                model_facts = {
                    "client_name": case["client_name"],
                    "outstanding_documents": [
                        {"name": document["name"], "category": document["category"]}
                        for document in context["facts"]["documents"]
                    ],
                }
                model_draft_context = {
                    "assigned_rm": case["rm_name"],
                    "due_date": context["draft_context"]["due_date"],
                }

            generated = await self.gemini.answer(
                question=question,
                intent=context["intent"],
                facts=model_facts,
                draft_context=model_draft_context,
            )
            answer = generated.answer
            draft_result = None
            if context["is_draft"] and generated.reminder_draft and context["case_id"]:
                due_date = context["draft_context"]["due_date"]
                draft_result = self.repository.create_ai_reminder(
                    user=user,
                    case_id=context["case_id"],
                    document_ids=context["document_ids"],
                    subject=generated.reminder_draft.subject,
                    body=generated.reminder_draft.body,
                    due_date=due_date,
                )
                sources = [
                    *sources,
                    {
                        "id": context["case_id"],
                        "label": f"Pending RM review · reminder {draft_result['id'][:8]}",
                        "type": "reminder",
                    },
                ]
                answer = f"{answer}\n\nSaved as a pending draft for {user.name} to review. It has not been approved or sent."
            elif context["is_draft"]:
                raise HTTPException(status_code=409, detail="A reminder draft requires an assigned RM and outstanding documents.")

            outcome = "success"
            answer_length = len(answer)
            return self._response(request_id, answer, sources, context, draft=draft_result)
        except HTTPException as error:
            outcome = f"http_{error.status_code}"
            raise
        except TimeoutError as error:
            outcome = "timeout"
            logger.warning("Gemini request timed out request_id=%s", request_id)
            raise HTTPException(status_code=504, detail="Gemini timed out. Please try again.") from error
        except Exception as error:
            api_status = getattr(error, "code", None)
            if api_status == 429:
                outcome = "rate_limited"
                logger.warning("Gemini rate limit request_id=%s", request_id)
                raise HTTPException(status_code=429, detail="Gemini is rate limited. Wait briefly and try again.") from error
            outcome = "upstream_error"
            logger.warning("Gemini request failed request_id=%s error_type=%s", request_id, type(error).__name__)
            raise HTTPException(status_code=502, detail="Gemini could not complete this grounded answer. Please retry.") from error
        finally:
            if context is not None:
                duration = int((time.monotonic() - started) * 1000)
                try:
                    self.repository.record_ai_audit(
                        request_id=request_id,
                        user=user,
                        intent=context["intent"],
                        model=self.settings.gemini_model,
                        outcome=outcome,
                        source_count=len(sources),
                        answer_length=answer_length,
                        duration_ms=duration,
                    )
                except Exception as error:
                    logger.error("Assistant audit write failed request_id=%s error_type=%s", request_id, type(error).__name__)

    @staticmethod
    def _response(
        request_id: str,
        answer: str,
        sources: list[dict[str, str]],
        context: dict[str, Any],
        *,
        draft: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return {
            "requestId": request_id,
            "answer": answer,
            "sources": sources,
            "intent": context["intent"],
            "aggregated": context["aggregated"],
            "reminderDraft": draft,
        }
