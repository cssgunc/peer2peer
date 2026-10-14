from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


@pytest.fixture(scope="session")
def test_engine() -> Engine:
    from app.config import get_settings

    return create_engine(get_settings().test_database_url)


@pytest.fixture(scope="session")
def _schema(test_engine: Engine) -> Iterator[None]:
    from app.database import Base
    from app.main import app  # noqa: F401 -- register application models

    Base.metadata.create_all(test_engine)
    yield
    Base.metadata.drop_all(test_engine)


@pytest.fixture(autouse=True)
def _rate_limits() -> None:
    from app.security.rate_limit import reset_rate_limits

    # The limiter is process-wide, so clear it to keep one test's hits from blocking another.
    reset_rate_limits()


@pytest.fixture
def db(_schema: None, test_engine: Engine) -> Iterator[Session]:
    # Each test runs inside a transaction that is rolled back, so tests never see each other's rows.
    with test_engine.connect() as connection:
        transaction = connection.begin()
        session_factory = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
        session = session_factory(bind=connection, join_transaction_mode="create_savepoint")
        yield session
        session.close()
        transaction.rollback()


@pytest.fixture
def client(db: Session, _rate_limits: None) -> Iterator[TestClient]:
    from app.database import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
