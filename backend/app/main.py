from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_exception_handlers
from app.logging import RequestLoggingMiddleware, configure_logging
from app.routers import (
    auth,
    chat,
    content,
    faqs,
    feedback,
    fit_guide,
    health,
    hours,
    report,
    resources,
    settings,
    statistics,
    status,
)
from app.routers.admin import accounts as admin_accounts
from app.routers.admin import faqs as admin_faqs
from app.routers.admin import fit_guide as admin_fit_guide
from app.routers.admin import hours as admin_hours
from app.routers.admin import report_options as admin_report_options
from app.routers.admin import resources as admin_resources
from app.routers.admin import statistics as admin_statistics
from app.routers.portal import inbox as portal_inbox
from app.routers.portal import shift as portal_shift
from app.routers.portal import ws as portal_ws

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
app.include_router(auth.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(settings.router, prefix="/api")

app.include_router(content.router, prefix="/api")
app.include_router(hours.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(resources.router, prefix="/api")
app.include_router(status.router, prefix="/api")
app.include_router(faqs.router, prefix="/api")
app.include_router(statistics.router, prefix="/api")
app.include_router(admin_accounts.router, prefix="/api")
app.include_router(admin_faqs.router, prefix="/api")
app.include_router(admin_statistics.router, prefix="/api")
app.include_router(fit_guide.router, prefix="/api")
app.include_router(admin_fit_guide.router, prefix="/api")
app.include_router(report.router, prefix="/api")
app.include_router(portal_shift.router, prefix="/api")
app.include_router(portal_inbox.router, prefix="/api")
app.include_router(admin_report_options.router, prefix="/api")
app.include_router(admin_resources.router, prefix="/api")
app.include_router(portal_ws.router)

app.include_router(admin_hours.router, prefix="/api")
