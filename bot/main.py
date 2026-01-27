from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from .config import BOT_NAME, BOT_TOKEN, UPLOADS_DIR
from .handlers import ROUTERS
from .middlewares.intent_reset import IntentResetMiddleware
from .state import STORAGE


async def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not set.")

    logging.basicConfig(level=logging.INFO)
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=STORAGE)
    dp.message.middleware(IntentResetMiddleware())
    for router in ROUTERS:
        dp.include_router(router)

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    logging.info("Starting %s", BOT_NAME)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())

