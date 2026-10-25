"""Development seeds. Registered functions must be safe to run repeatedly."""

from collections.abc import Callable

from sqlalchemy.orm import Session

SeedFunction = Callable[[Session], None]
registry: list[SeedFunction] = []


def register(seed: SeedFunction) -> SeedFunction:
    """Register an idempotent seed function, also usable as a decorator."""
    registry.append(seed)
    return seed


def seed_dev() -> None:
    from app.config import get_settings

    if get_settings().environment != "development":
        raise RuntimeError("seed-dev is only allowed in the development environment")

    import app.services.resources  # noqa: F401 -- registers its seed function
    import app.services.site_settings  # noqa: F401 -- registers its seed function
    from app.database import SessionLocal

    with SessionLocal.begin() as session:
        for seed in registry:
            seed(session)


@register
def seed_hours(session: Session) -> None:
    """Placeholder hours pending Peer2Peer's decision; preserve existing schedules."""
    from datetime import datetime, time, timedelta
    from zoneinfo import ZoneInfo

    from sqlalchemy import select

    from app.config import get_settings
    from app.models.hours import HoursException, WeeklyHours

    if session.scalar(select(WeeklyHours.id).limit(1)) is None:
        session.add_all(
            WeeklyHours(day_of_week=day, opens_at=time(19), closes_at=time(23))
            for day in (0, 1, 2, 3, 6)
        )
    if session.scalar(select(HoursException.id).limit(1)) is None:
        today = datetime.now(ZoneInfo(get_settings().line_timezone)).date()
        session.add(
            HoursException(
                date=today + timedelta(days=7),
                is_closed=True,
                note="Placeholder closure (development only)",
            )
        )
    session.flush()
