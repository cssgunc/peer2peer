from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_exception_handlers
from app.logging import RequestLoggingMiddleware, configure_logging
from app.routers import content, feedback, health, hours, resources, settings, status
from app.routers.admin import accounts as admin_accounts

configure_logging()

app = FastAPI(title="Peer2Peer API")

register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestLoggingMiddleware)

app.include_router(health.router, prefix="/api")
app.include_router(settings.router, prefix="/api")

app.include_router(content.router, prefix="/api")
app.include_router(hours.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(resources.router, prefix="/api")
app.include_router(status.router, prefix="/api")

app.include_router(admin_accounts.router, prefix="/api")
