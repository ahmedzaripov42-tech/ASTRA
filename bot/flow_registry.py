from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ChatUser:
    chat_id: int
    user_id: int


_ACTIVE: set[ChatUser] = set()


def track(chat_id: int, user_id: int) -> None:
    _ACTIVE.add(ChatUser(chat_id=chat_id, user_id=user_id))


def untrack(chat_id: int, user_id: int) -> None:
    _ACTIVE.discard(ChatUser(chat_id=chat_id, user_id=user_id))


def all_active() -> set[ChatUser]:
    return set(_ACTIVE)

