"""Aggregate conversation metadata and reports only; independent of message retention."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.messaging import Channel, Conversation
from app.models.report import ConversationReport, ConversationReportTopic, ReportOption
from app.schemas.analytics import (
    AnalyticsBucketDTO,
    AnalyticsDayDTO,
    AnalyticsRangeDTO,
    FirstResponseDTO,
    LineAnalyticsDTO,
    MedianDTO,
)

# TDD open question 13: revisit with Peer2Peer before launch.
SUPPRESSION_THRESHOLD = 5


def line_analytics(
    db: Session, start: date, end: date, channel: Channel | None = None
) -> LineAnalyticsDTO:
    """Compute SQL aggregates for a validated, inclusive range of local opening dates.

    Missing response/close timestamps are excluded from their respective percentiles by SQL.
    Report submission dates do not affect the cohort, and retired options remain in history.
    """
    timezone = get_settings().line_timezone
    zone = ZoneInfo(timezone)
    # Convert each local midnight separately so DST days can have 23 or 25 hours.
    since = datetime.combine(start, time.min, zone).astimezone(UTC)
    until = datetime.combine(end + timedelta(days=1), time.min, zone).astimezone(UTC)
    query = select(
        Conversation.id,
        Conversation.channel,
        Conversation.opened_at,
        Conversation.first_response_at,
        Conversation.closed_at,
        Conversation.message_count,
        Conversation.opened_after_hours,
    ).where(Conversation.opened_at >= since, Conversation.opened_at < until)
    if channel is not None:
        query = query.where(Conversation.channel == channel)
    cohort = query.cte("cohort")

    response_seconds = func.extract("epoch", cohort.c.first_response_at - cohort.c.opened_at)
    duration_seconds = func.extract("epoch", cohort.c.closed_at - cohort.c.opened_at)
    summary = db.execute(
        select(
            func.count().label("total"),
            func.percentile_cont(0.5).within_group(response_seconds).label("response_median"),
            func.percentile_cont(0.9).within_group(response_seconds).label("response_p90"),
            func.percentile_cont(0.5).within_group(duration_seconds).label("duration_median"),
            func.percentile_cont(0.5).within_group(cohort.c.message_count).label("messages_median"),
            func.count().filter(cohort.c.opened_after_hours).label("after_hours"),
        ).select_from(cohort)
    ).one()

    channel_counts = db.execute(
        select(cohort.c.channel, func.count())
        .group_by(cohort.c.channel)
        .having(func.count() >= SUPPRESSION_THRESHOLD)
        .order_by(cohort.c.channel)
    )
    by_channel = {channel.value: count for channel, count in channel_counts}

    reports = (
        select(ConversationReport.id, ConversationReport.outcome_id, ConversationReport.confidence)
        .join(cohort, cohort.c.id == ConversationReport.conversation_id)
        .cte("reports")
    )
    report_count, confidence_avg = db.execute(
        select(func.count(), func.avg(reports.c.confidence)).select_from(reports)
    ).one()

    # Aggregate topics separately: a report with multiple topics must count only once in
    # conversation totals, outcome counts, and the confidence average.
    topic_counts = db.execute(
        select(ReportOption.label, func.count())
        .select_from(reports)
        .join(ConversationReportTopic, ConversationReportTopic.report_id == reports.c.id)
        .join(ReportOption, ReportOption.id == ConversationReportTopic.option_id)
        .group_by(ReportOption.id)
        .having(func.count() >= SUPPRESSION_THRESHOLD)
        .order_by(ReportOption.display_order, ReportOption.label, ReportOption.id)
    )
    topics = [AnalyticsBucketDTO(label=label, count=count) for label, count in topic_counts]
    outcome_counts = db.execute(
        select(ReportOption.label, func.count())
        .select_from(reports)
        .join(ReportOption, ReportOption.id == reports.c.outcome_id)
        .group_by(ReportOption.id)
        .having(func.count() >= SUPPRESSION_THRESHOLD)
        .order_by(ReportOption.display_order, ReportOption.label, ReportOption.id)
    )
    outcomes = [AnalyticsBucketDTO(label=label, count=count) for label, count in outcome_counts]

    local_day = cast(func.timezone(timezone, cohort.c.opened_at), Date)
    daily_counts = dict(db.execute(select(local_day, func.count()).group_by(local_day)).all())
    # Daily counts are deliberately unsuppressed: this is volume over time, not a
    # breakdown of who said what. Revisit separately if the suppression policy changes.
    series = [
        AnalyticsDayDTO(date=day, conversations=daily_counts.get(day, 0))
        for offset in range((end - start).days + 1)
        for day in [start + timedelta(days=offset)]
    ]
    return LineAnalyticsDTO(
        range=AnalyticsRangeDTO(start=start, end=end),
        conversations_total=summary.total,
        by_channel=by_channel,
        first_response_seconds=FirstResponseDTO(
            median=summary.response_median, p90=summary.response_p90
        ),
        duration_seconds=MedianDTO(median=summary.duration_median),
        message_count=MedianDTO(median=summary.messages_median),
        after_hours_attempts=summary.after_hours,
        topics=topics,
        outcomes=outcomes,
        confidence_avg=confidence_avg if report_count >= SUPPRESSION_THRESHOLD else None,
        series=series,
        suppression_threshold=SUPPRESSION_THRESHOLD,
    )
