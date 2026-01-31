from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from .config import BOT_NAME, BOT_TOKEN, MANHWA_PATH, UPLOADS_DIR
from .handlers import ROUTERS
from .middlewares.intent_reset import IntentResetMiddleware
from .state import STORAGE
from server import processor


async def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not set.")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=STORAGE)
    dp.message.middleware(IntentResetMiddleware())
    for router in ROUTERS:
        dp.include_router(router)

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    logging.info("Starting bot: %s", BOT_NAME)
    manhwas = processor.load_manhwa(MANHWA_PATH)
    logging.info("Loaded %s manhwa from %s", len(manhwas), MANHWA_PATH.resolve())
    if not manhwas:
        logging.error("manhwa.json is empty or missing. Upload menus will be empty.")
    logging.info("Bot ready")
    try:
        await dp.start_polling(bot)
    except Exception:  # noqa: BLE001
        logging.exception("Bot crashed during polling")
        raise


if __name__ == "__main__":
    asyncio.run(main())

