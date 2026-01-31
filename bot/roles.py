from __future__ import annotations

import json
import logging
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

_ROLE_CACHE: Dict[str, List[int]] | None = None
_ROLE_CACHE_MTIME: float | None = None


def _clone_roles(data: Dict[str, List[int]]) -> Dict[str, List[int]]:
    return {key: list(value) for key, value in data.items()}


def _load_roles(path: Path = ADMINS_PATH) -> Dict[str, List[int]]:
    global _ROLE_CACHE, _ROLE_CACHE_MTIME
    if not path.exists():
        _save_roles(DEFAULT_ROLES, path)
        _ROLE_CACHE = _clone_roles(DEFAULT_ROLES)
        try:
            _ROLE_CACHE_MTIME = path.stat().st_mtime
        except OSError:
            _ROLE_CACHE_MTIME = None
        return _clone_roles(DEFAULT_ROLES)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = None
    if _ROLE_CACHE is not None and mtime is not None and _ROLE_CACHE_MTIME == mtime:
        return _clone_roles(_ROLE_CACHE)
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:  # noqa: BLE001
        logging.exception("Failed to read roles at %s", path.resolve())
        if _ROLE_CACHE is not None:
            return _clone_roles(_ROLE_CACHE)
        return _clone_roles(DEFAULT_ROLES)
    for key, value in DEFAULT_ROLES.items():
        data.setdefault(key, value)
    for key, value in data.items():
        if not isinstance(value, list):
            data[key] = []
            continue
        normalized = []
        for item in value:
            try:
                normalized.append(int(item))
            except (TypeError, ValueError):
                continue
        data[key] = normalized
    _ROLE_CACHE = _clone_roles(data)
    _ROLE_CACHE_MTIME = mtime
    return _clone_roles(data)


def _save_roles(data: Dict[str, List[int]], path: Path = ADMINS_PATH) -> None:
    global _ROLE_CACHE, _ROLE_CACHE_MTIME
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    temp_path.replace(path)
    _ROLE_CACHE = _clone_roles(data)
    try:
        _ROLE_CACHE_MTIME = path.stat().st_mtime
    except OSError:
        _ROLE_CACHE_MTIME = None


def get_roles() -> Dict[str, List[int]]:
    return _load_roles()


def is_blocked(user_id: int) -> bool:
    roles = _load_roles()
    return user_id in roles.get("blocked", [])


def is_admin_user(user_id: int) -> bool:
    roles = _load_roles()
    if user_id in roles.get("blocked", []):
        return False
    return (
        user_id in roles.get("owner", [])
        or user_id in roles.get("admins", [])
        or user_id in roles.get("editors", [])
    )


def has_role(user_id: int, role: str) -> bool:
    roles = _load_roles()
    return user_id in roles.get(role, [])


def is_owner(user_id: int) -> bool:
    return has_role(user_id, "owner")


def can_manage_manhwa(user_id: int) -> bool:
    return is_admin_user(user_id)


def can_upload(user_id: int) -> bool:
    roles = _load_roles()
    if user_id in roles.get("blocked", []):
        return False
    return (
        is_admin_user(user_id)
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

