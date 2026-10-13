import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("app.request")


class RedactWebSocketFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return '"WebSocket ' not in record.getMessage()


def configure_logging() -> None:
    ws_filter = RedactWebSocketFilter()
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.addFilter(ws_filter)
        for handler in uv_logger.handlers:
            handler.addFilter(ws_filter)
    app_logger = logging.getLogger("app")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status = 500  # stays 500 if the app raises before responding

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            # scope["path"] has no query string; we never read client, headers, or body
            logger.info("%s %s %d %.1fms", scope["method"], scope["path"], status, duration_ms)
