import logging
import os
import time
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL environment variable is required")
SUPABASE_URL = SUPABASE_URL.rstrip("/")

SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1"
SUPABASE_JWKS_URL = f"{SUPABASE_ISSUER}/.well-known/jwks.json"
SUPABASE_AUDIENCE = "authenticated"
JWKS_CACHE_TTL_SECONDS = 3600

ALLOWED_GOOGLE_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ALLOWED_GOOGLE_EMAILS", "").split(",")
    if email.strip()
}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

# kid -> JWK の辞書。Supabase側のキーローテーションに追従できるよう、
# 未知のkidに出会ったら一度だけ再フェッチする。
_jwks_cache: Dict[str, Any] = {"keys_by_kid": {}, "fetched_at": 0.0}


def _fetch_jwks() -> Dict[str, Any]:
    response = requests.get(SUPABASE_JWKS_URL, timeout=5)
    response.raise_for_status()
    keys = response.json().get("keys", [])
    return {key["kid"]: key for key in keys if "kid" in key}


def _get_signing_key(kid: str) -> Dict[str, Any]:
    now = time.monotonic()
    is_stale = now - _jwks_cache["fetched_at"] > JWKS_CACHE_TTL_SECONDS
    if kid not in _jwks_cache["keys_by_kid"] or is_stale:
        _jwks_cache["keys_by_kid"] = _fetch_jwks()
        _jwks_cache["fetched_at"] = now

    key = _jwks_cache["keys_by_kid"].get(kid)
    if not key:
        raise JWTError(f"Unknown JWT key id: {kid}")
    return key


def verify_token(token: str) -> Dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not kid:
            raise JWTError("Missing kid in token header")
        key = _get_signing_key(kid)
        payload = jwt.decode(
            token,
            key,
            algorithms=[header.get("alg", "ES256")],
            audience=SUPABASE_AUDIENCE,
            issuer=SUPABASE_ISSUER,
        )
    except JWTError as exc:
        logger.warning("Supabase JWT verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return payload


async def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict[str, Any]:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(token)
    email = str(payload.get("email", "")).lower()
    if email not in ALLOWED_GOOGLE_EMAILS:
        logger.warning("Login rejected: email not in allowlist (%s)", email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このGoogleアカウントではログインできません",
        )
    return payload
