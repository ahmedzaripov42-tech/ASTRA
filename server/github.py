from __future__ import annotations

import subprocess
from pathlib import Path


def git_push(message: str, repo: str = "", token: str = "") -> str:
    try:
        if repo and token:
            _configure_remote(repo, token)
        if not _has_changes():
            return "No changes to push."
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", message], check=True)
        subprocess.run(["git", "push"], check=True)
        return "Git push completed."
    except subprocess.CalledProcessError as exc:
        return f"Git push failed: {exc}"


def netlify_deploy(hook: str) -> str:
    if not hook:
        return "Netlify hook is not configured."
    try:
        import requests

        response = requests.post(hook, timeout=30)
        if response.ok:
            return "Netlify deploy triggered."
        return f"Netlify deploy failed: {response.status_code}"
    except Exception as exc:  # noqa: BLE001
        return f"Netlify deploy failed: {exc}"


def _has_changes() -> bool:
    result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
    return bool(result.stdout.strip())


def _configure_remote(repo: str, token: str) -> None:
    remote_url = f"https://{token}@github.com/{repo}.git"
    subprocess.run(["git", "remote", "set-url", "origin", remote_url], check=False)

