import csv
from datetime import date, datetime, timedelta
from io import StringIO
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.errors import AppError
from app.models.messaging import Channel
from app.schemas.analytics import AnalyticsRangeDTO, LineAnalyticsDTO
from app.services.analytics import line_analytics

router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin"],
    dependencies=[Depends(require_coordinator)],
)
Database = Annotated[Session, Depends(get_db)]


def analytics_range(start: date | None = None, end: date | None = None) -> AnalyticsRangeDTO:
    """Default to 30 local dates ending today (or the supplied end), inclusive."""
    end = end if end is not None else datetime.now(ZoneInfo(get_settings().line_timezone)).date()
    try:
        start = start if start is not None else end - timedelta(days=29)
        # The service uses an exclusive next-midnight bound, which must be representable.
        if end == date.max or not 1 <= (end - start).days + 1 <= 366:
            raise ValueError
    except ValueError, OverflowError:
        raise AppError(
            422,
            "validation_error",
            "Date range must contain 1 to 366 days and end before 9999-12-31.",
        ) from None
    return AnalyticsRangeDTO(start=start, end=end)


DateRange = Annotated[AnalyticsRangeDTO, Depends(analytics_range)]


@router.get("/line", response_model=LineAnalyticsDTO)
def get_line_analytics(
    db: Database, dates: DateRange, channel: Channel | None = None
) -> LineAnalyticsDTO:
    return line_analytics(db, dates.start, dates.end, channel)


@router.get("/line.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}}})
def export_line_analytics(db: Database, dates: DateRange) -> Response:
    # Serialize the same suppressed DTO as JSON; no export path can expose hidden buckets.
    analytics = line_analytics(db, dates.start, dates.end)
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["section", "label", "value"])
    for section, value in analytics.model_dump(mode="json").items():
        if isinstance(value, dict):
            for label, count in value.items():
                writer.writerow([section, label, count])
        elif section in {"topics", "outcomes"}:
            for bucket in value:
                label = bucket["label"]
                # Option labels are editable. Keep spreadsheet apps from evaluating formulas.
                if label.lstrip().startswith(("=", "+", "-", "@")) or label.startswith(
                    ("\t", "\r", "\n")
                ):
                    label = "'" + label
                writer.writerow([section, label, bucket["count"]])
        elif section == "series":
            for day in value:
                writer.writerow([section, day["date"], day["conversations"]])
        else:
            # csv.writer represents null averages/medians as empty cells, never zero.
            writer.writerow(["summary", section, value])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="line-analytics-{dates.start}-{dates.end}.csv"'
            ),
        },
    )
