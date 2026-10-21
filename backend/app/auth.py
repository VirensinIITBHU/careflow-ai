"""Role guard. Roles: intake (create/withdraw cases), reviewer (review), admin (everything + audit)."""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import db

_bearer = HTTPBearer(auto_error=False)


class User(BaseModel):
    username: str
    role: str


def current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> User:
    row = db.session_user(creds.credentials) if creds else None
    if row is None:
        raise HTTPException(401, "Sign in required")
    return User(username=row["username"], role=row["role"])


def bearer_token(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    return creds.credentials if creds else ""


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Role '{user.role}' is not allowed to do this")
        return user
    return dep
