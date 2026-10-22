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

    from app.database import SessionLocal

    with SessionLocal.begin() as session:
        for seed in registry:
            seed(session)


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
