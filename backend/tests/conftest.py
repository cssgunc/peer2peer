from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.database import Base, get_db
from app.main import app
from app.security.rate_limit import reset_rate_limits

test_engine = create_engine(get_settings().test_database_url)
TestSessionLocal = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    Base.metadata.create_all(test_engine)
    yield
    Base.metadata.drop_all(test_engine)


@pytest.fixture(autouse=True)
def _rate_limits() -> None:
    # The limiter is process-wide, so clear it to keep one test's hits from blocking another.
    reset_rate_limits()


@pytest.fixture
def db() -> Iterator[Session]:
    # Each test runs inside a transaction that is rolled back, so tests never see each other's rows.
    with test_engine.connect() as connection:
        transaction = connection.begin()
        session = TestSessionLocal(bind=connection, join_transaction_mode="create_savepoint")
        yield session
        session.close()
        transaction.rollback()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
