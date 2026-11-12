from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, Request, Response

from assistant.app.config import Settings

Role = Literal["relationship_manager", "ops", "coo", "analyst"]
SESSION_COOKIE = "northgate_demo_session"


@dataclass(frozen=True)
class SessionUser:
    name: str
    role: Role


def encode_session(
    user: SessionUser,
    secret: str,
    now: int | None = None,
    ttl_seconds: int = 8 * 60 * 60,
) -> str:
    issued_at = int(time.time()) if now is None else now
    payload = json.dumps(
        {"name": user.name, "role": user.role, "exp": issued_at + ttl_seconds},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def decode_session(token: str, secret: str, now: int | None = None) -> SessionUser:
    try:
        encoded, supplied_signature = token.split(".", 1)
        expected_signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("Invalid signature")
        payload_bytes = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(payload_bytes)
        if not isinstance(payload, dict) or not isinstance(payload.get("name"), str):
            raise ValueError("Invalid payload")
        role = payload.get("role")
        if role not in {"relationship_manager", "ops", "coo", "analyst"}:
            raise ValueError("Invalid role")
        current_time = int(time.time()) if now is None else now
        if not isinstance(payload.get("exp"), int) or payload["exp"] <= current_time:
            raise ValueError("Expired session")
        return SessionUser(name=payload["name"], role=role)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=401, detail="A valid demo session is required.") from error


def current_user(request: Request) -> SessionUser:
    settings: Settings = request.app.state.settings
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to the Northgate demo workspace first.")
    return decode_session(token, settings.session_secret)


def set_session_cookie(response: Response, user: SessionUser, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=encode_session(user, settings.session_secret, ttl_seconds=settings.session_ttl_seconds),
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/api", httponly=True, samesite="strict")
