"""Development seeds. Registered functions must be safe to run repeatedly."""

from collections.abc import Callable

from sqlalchemy.orm import Session

SeedFunction = Callable[[Session], None]
registry: list[SeedFunction] = []
DEV_PASSWORD = "SuperSecretAdminPassword123"


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
def seed_accounts(session: Session) -> None:
    """Create development staff without overwriting existing accounts."""
    from sqlalchemy import select

    from app.models import Account, AccountRole
    from app.security.passwords import hash_password

    for role in AccountRole:
        email = f"{role.value}@example.com"
        if session.scalar(select(Account.id).where(Account.email == email)) is None:
            session.add(
                Account(
                    email=email,
                    display_name=f"Development {role.value}",
                    password_hash=hash_password(DEV_PASSWORD),
                    role=role,
                    must_change_password=False,
                )
            )
            session.flush()
            print(f"Development account: {email} / password: {DEV_PASSWORD}")


@register
def seed_faqs_and_statistics(session: Session) -> None:
    """Sample development copy; pending privacy answers remain drafts."""
    from sqlalchemy import select

    from app.models import Faq, Statistic

    faqs = [
        ("Getting started", "What is Peer2Peer?", "Peer support from fellow UNC students.", True),
        (
            "Getting started",
            "What can I talk about?",
            "You can talk about what is on your mind.",
            True,
        ),
        ("Getting started", "Do I need an appointment?", "No appointment is needed.", True),
        ("Hours", "When can I reach Peer2Peer?", "Check the current hours on our website.", True),
        (
            "Hours",
            "What if the line is closed?",
            "Visit our resources page for other support.",
            True,
        ),
        ("Anonymity", "Is my conversation anonymous?", "Draft: pending the privacy policy.", False),
        ("Anonymity", "What information is retained?", "Draft: pending the privacy policy.", False),
        (
            "Safety",
            "When might someone escalate a concern?",
            "Draft: pending the safety protocol.",
            False,
        ),
    ]
    for order, (category, question, answer, published) in enumerate(faqs):
        if session.scalar(select(Faq.id).where(Faq.question == question)) is None:
            session.add(
                Faq(
                    category=category,
                    question=question,
                    answer_md=answer,
                    display_order=order,
                    is_published=published,
                )
            )
    for order, (label, value, published) in enumerate(
        [
            ("Sample conversations this semester", "120+", True),
            ("Sample trained peer supporters", "20", True),
            ("Sample hours of support", "80+", False),
        ]
    ):
        if session.scalar(select(Statistic.id).where(Statistic.label == label)) is None:
            session.add(
                Statistic(label=label, value=value, display_order=order, is_published=published)
            )
    session.flush()


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
