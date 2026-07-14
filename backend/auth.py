import datetime
import logging
import os
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt

load_dotenv()

logger = logging.getLogger(__name__)

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "168"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
ALLOWED_GOOGLE_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ALLOWED_GOOGLE_EMAILS", "").split(",")
    if email.strip()
}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


def get_secret_key() -> str:
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY environment variable is required")
    return secret


def verify_google_id_token(credential: str) -> str:
    try:
        payload = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=10,
        )
    except ValueError as exc:
        logger.warning("Google ID token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google credential",
        ) from exc

    email = str(payload.get("email", "")).lower()
    if not payload.get("email_verified") or email not in ALLOWED_GOOGLE_EMAILS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このGoogleアカウントではログインできません",
        )
    return email


def create_access_token(sub: str, expires_hours: Optional[int] = None) -> str:
    hours = expires_hours if expires_hours is not None else TOKEN_EXPIRE_HOURS
    payload = {
        "sub": sub,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=hours),
    }
    return jwt.encode(payload, get_secret_key(), algorithm=ALGORITHM)


def verify_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict[str, Any]:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return verify_token(token)
