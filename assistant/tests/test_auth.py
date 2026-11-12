from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.responses import Response

from assistant.app.auth import SessionUser, decode_session, encode_session, set_session_cookie
from assistant.app.config import Settings


def test_signed_session_round_trip_and_tamper_detection() -> None:
    user = SessionUser(name="Alice RM", role="relationship_manager")
    token = encode_session(user, "test-secret", now=1000, ttl_seconds=120)
    assert decode_session(token, "test-secret", now=1001) == user
    with pytest.raises(HTTPException) as error:
        decode_session(token + "bad", "test-secret", now=1001)
    assert error.value.status_code == 401


def test_expired_demo_session_is_rejected() -> None:
    user = SessionUser(name="Claire Sterling", role="ops")
    token = encode_session(user, "test-secret", now=1000, ttl_seconds=5)
    with pytest.raises(HTTPException) as error:
        decode_session(token, "test-secret", now=1005)
    assert error.value.status_code == 401


def test_invalid_role_claim_is_rejected() -> None:
    user = SessionUser(name="Evelyn Hart", role="coo")
    token = encode_session(user, "test-secret", now=1000)
    encoded, signature = token.split(".", 1)
    import base64
    import hashlib
    import hmac
    import json

    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    payload["role"] = "administrator"
    altered = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).rstrip(b"=").decode()
    new_signature = hmac.new(b"test-secret", altered.encode(), hashlib.sha256).hexdigest()
    with pytest.raises(HTTPException) as error:
        decode_session(f"{altered}.{new_signature}", "test-secret", now=1001)
    assert error.value.status_code == 401


@pytest.mark.parametrize(("secure", "expected"), [(False, False), (True, True)])
def test_demo_session_cookie_secure_flag(secure: bool, expected: bool) -> None:
    settings = Settings(
        database_path=Path("test.sqlite"),
        gemini_api_key=None,
        gemini_model="gemini-test",
        session_secret="test-session-secret",
        session_ttl_seconds=3600,
        gemini_timeout_seconds=1,
        demo_auth_enabled=True,
        cookie_secure=secure,
    )
    response = Response()
    set_session_cookie(response, SessionUser(name="Alice RM", role="relationship_manager"), settings)
    assert ("secure" in response.headers["set-cookie"].lower()) is expected
