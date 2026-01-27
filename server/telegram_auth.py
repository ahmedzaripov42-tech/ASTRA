from __future__ import annotations

import hashlib
import hmac
from typing import Dict
from urllib.parse import parse_qsl


def verify_init_data(init_data: str, bot_token: str) -> Dict:
    data = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = data.pop("hash", "")
    secret = hmac.new(key=b"WebAppData", msg=bot_token.encode(), digestmod=hashlib.sha256).digest()
    data_check_string = "\n".join([f"{k}={v}" for k, v in sorted(data.items())])
    calc_hash = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc_hash, received_hash):
        raise ValueError("Invalid init data signature.")
    return data

