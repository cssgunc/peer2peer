import asyncio
import logging
import threading
from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app import cli, events
from app.config import get_settings
from app.jobs import runner
from app.main import app, lifespan
from app.models.site_setting import SiteSetting

NOW = datetime(2026, 11, 7, 18, tzinfo=UTC)


def test_failed_job_rolls_back_and_other_jobs_commit_in_separate_sessions(
    db: Session, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    sessions: list[Session] = []
    published: list[tuple[str, events.Event]] = []
    monkeypatch.setattr(
        events.event_bus, "publish", lambda topic, event: published.append((topic, event))
    )
    monkeypatch.setattr(
        runner,
        "SessionLocal",
        sessionmaker(bind=db.get_bind(), join_transaction_mode="create_savepoint"),
    )

    def failed_job(session: Session, now: datetime) -> int:
        assert now == NOW
        sessions.append(session)
        session.add(SiteSetting(key="failed-job", value="should roll back"))
        session.flush()
        events.publish_after_commit(session, "test", {"type": "failed", "data": {}})
        raise RuntimeError("private message and account@example.com must never be logged")

    def successful_job(session: Session, now: datetime) -> int:
        assert now == NOW
        sessions.append(session)
        assert session.get(SiteSetting, "failed-job") is None
        session.add(SiteSetting(key="successful-job", value=True))
        events.publish_after_commit(session, "test", {"type": "successful", "data": {}})
        return 1

    def final_job(session: Session, now: datetime) -> int:
        assert now == NOW
        sessions.append(session)
        assert session.get(SiteSetting, "successful-job") is not None
        return 0

    monkeypatch.setattr(runner, "JOBS", (failed_job, successful_job, final_job))
    with caplog.at_level(logging.ERROR, logger="app.jobs"):
        assert runner.run_jobs_once(NOW) is False

    assert len({id(session) for session in sessions}) == 3
    assert db.get(SiteSetting, "failed-job") is None
    assert db.get(SiteSetting, "successful-job") is not None
    assert published == [("test", {"type": "successful", "data": {}})]
    records = [record for record in caplog.records if record.name == "app.jobs"]
    assert len(records) == 1
    assert records[0].getMessage() == "failed_job RuntimeError"
    assert records[0].exc_info is None


def test_successful_pass_returns_true(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runner,
        "SessionLocal",
        sessionmaker(bind=db.get_bind(), join_transaction_mode="create_savepoint"),
    )
    assert runner.run_jobs_once(NOW) is True


def test_runner_repeats_off_event_loop_and_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    async def exercise() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        threads: list[int] = []

        def run_once() -> bool:
            threads.append(threading.get_ident())
            if len(threads) == 2:
                loop.call_soon_threadsafe(stop.set)
            return True

        monkeypatch.setattr(runner, "run_jobs_once", run_once)
        monkeypatch.setattr(runner, "JOB_INTERVAL_SECONDS", 0.001)
        await asyncio.wait_for(runner.run_background_jobs(stop), timeout=2)
        assert len(threads) == 2
        assert all(thread != threading.get_ident() for thread in threads)

    asyncio.run(exercise())


def test_runner_waits_for_in_flight_pass_before_stopping(monkeypatch: pytest.MonkeyPatch) -> None:
    async def exercise() -> None:
        stop = asyncio.Event()
        started = asyncio.Event()
        release = threading.Event()
        finished = threading.Event()
        loop = asyncio.get_running_loop()

        def run_once() -> bool:
            loop.call_soon_threadsafe(started.set)
            assert release.wait(timeout=2)
            finished.set()
            return True

        monkeypatch.setattr(runner, "run_jobs_once", run_once)
        task = asyncio.create_task(runner.run_background_jobs(stop))
        try:
            await asyncio.wait_for(started.wait(), timeout=2)
            stop.set()
            await asyncio.sleep(0)
            assert not task.done()
        finally:
            release.set()
            await asyncio.wait_for(task, timeout=2)
        assert finished.is_set()

    asyncio.run(exercise())


@pytest.mark.parametrize("enabled", [False, True])
def test_lifespan_honors_setting_and_stops_runner(
    monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    import app.main as main

    async def exercise() -> None:
        started = asyncio.Event()
        stopped = asyncio.Event()

        async def background(stop: asyncio.Event) -> None:
            started.set()
            await stop.wait()
            stopped.set()

        monkeypatch.setattr(get_settings(), "run_background_jobs", enabled)
        monkeypatch.setattr(main, "run_background_jobs", background)
        async with lifespan(app):
            if enabled:
                await asyncio.wait_for(started.wait(), timeout=2)
            else:
                await asyncio.sleep(0)
                assert not started.is_set()
        assert stopped.is_set() == enabled

    asyncio.run(exercise())


def test_jobs_are_disabled_by_default_in_pytest() -> None:
    assert get_settings().run_background_jobs is False


@pytest.mark.parametrize("succeeded", [False, True])
def test_cli_runs_one_pass_and_reports_failure(
    monkeypatch: pytest.MonkeyPatch, succeeded: bool
) -> None:
    calls: list[bool] = []

    def run_once() -> bool:
        calls.append(True)
        return succeeded

    monkeypatch.setattr(runner, "run_jobs_once", run_once)
    if succeeded:
        cli.main(["run-jobs", "--once"])
    else:
        with pytest.raises(SystemExit) as error:
            cli.main(["run-jobs", "--once"])
        assert error.value.code == 1
    assert calls == [True]


def test_cli_requires_once_flag() -> None:
    with pytest.raises(SystemExit) as error:
        cli.main(["run-jobs"])
    assert error.value.code == 2
