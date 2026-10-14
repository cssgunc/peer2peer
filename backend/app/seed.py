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
