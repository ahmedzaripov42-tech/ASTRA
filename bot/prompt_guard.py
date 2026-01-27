from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PromptState:
    last_text: str = ""
    count: int = 0


_PROMPTS: dict[int, PromptState] = {}


def mark_prompt(user_id: int, text: str) -> int:
    state = _PROMPTS.get(user_id, PromptState())
    if state.last_text == text:
        state.count += 1
    else:
        state.last_text = text
        state.count = 1
    _PROMPTS[user_id] = state
    return state.count


def reset_prompt(user_id: int) -> None:
    _PROMPTS.pop(user_id, None)

