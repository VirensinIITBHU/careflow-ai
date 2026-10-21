import secrets
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import audit, config, db
from ..auth import User, bearer_token, current_user

router = APIRouter(prefix="/auth", tags=["auth"])


class Login(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: Login):
    role = config.USERS.get(body.username)
    if not role or not secrets.compare_digest(body.password, config.DEMO_PASSWORD):
        actor = re.sub(r"[\x00-\x1f\x7f]", "", body.username)[:40] or "unknown"
        with db.tx() as c:
            audit.append(c, actor, "unknown", "login_failed")
        raise HTTPException(401, "Invalid username or password")
    with db.tx() as c:
        token = db.new_session(c, body.username, role)
        audit.append(c, body.username, role, "login")
    return {"token": token, "username": body.username, "role": role}


@router.post("/logout")
def logout(token: str = Depends(bearer_token), user: User = Depends(current_user)):
    with db.tx() as c:
        db.delete_session(c, token)
        audit.append(c, user.username, user.role, "logout")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user
