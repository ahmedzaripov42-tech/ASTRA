from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from .config import ADMINS_PATH


DEFAULT_ROLES = {
    "owner": [],
    "admins": [],
    "editors": [],
    "uploaders": [],
    "moderators": [],
    "blocked": [],
}


def _load_roles(path: Path = ADMINS_PATH) -> Dict[str, List[int]]:
    if not path.exists():
        _save_roles(DEFAULT_ROLES, path)
        return DEFAULT_ROLES.copy()
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    for key, value in DEFAULT_ROLES.items():
        data.setdefault(key, value)
    return data


def _save_roles(data: Dict[str, List[int]], path: Path = ADMINS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def get_roles() -> Dict[str, List[int]]:
    return _load_roles()


def is_blocked(user_id: int) -> bool:
    roles = _load_roles()
    return user_id in roles.get("blocked", [])


def has_role(user_id: int, role: str) -> bool:
    roles = _load_roles()
    return user_id in roles.get(role, [])


def is_owner(user_id: int) -> bool:
    return has_role(user_id, "owner")


def can_manage_manhwa(user_id: int) -> bool:
    roles = _load_roles()
    return (
        user_id in roles.get("owner", [])
        or user_id in roles.get("admins", [])
        or user_id in roles.get("editors", [])
    )


def can_upload(user_id: int) -> bool:
    roles = _load_roles()
    return (
        user_id in roles.get("owner", [])
        or user_id in roles.get("admins", [])
        or user_id in roles.get("uploaders", [])
    )


def can_deploy(user_id: int) -> bool:
    roles = _load_roles()
    return user_id in _load_roles().get("admins", []) or is_owner(user_id)


def can_moderate(user_id: int) -> bool:
    roles = _load_roles()
    return (
        user_id in roles.get("owner", [])
        or user_id in roles.get("admins", [])
        or user_id in roles.get("moderators", [])
    )


def add_role(user_id: int, role: str) -> Dict[str, List[int]]:
    data = _load_roles()
    data.setdefault(role, [])
    if user_id not in data[role]:
        data[role].append(user_id)
    _save_roles(data)
    return data


def remove_role(user_id: int, role: str) -> Dict[str, List[int]]:
    data = _load_roles()
    data.setdefault(role, [])
    if user_id in data[role]:
        data[role].remove(user_id)
    _save_roles(data)
    return data

