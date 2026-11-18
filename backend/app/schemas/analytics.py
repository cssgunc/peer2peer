from datetime import date as Date

from pydantic import BaseModel


class AnalyticsRangeDTO(BaseModel):
    start: Date
    end: Date


class MedianDTO(BaseModel):
    median: float | None


class FirstResponseDTO(MedianDTO):
    p90: float | None


class AnalyticsBucketDTO(BaseModel):
    label: str
    count: int


class AnalyticsDayDTO(BaseModel):
    date: Date
    conversations: int


class LineAnalyticsDTO(BaseModel):
    range: AnalyticsRangeDTO
    conversations_total: int
    by_channel: dict[str, int]
    first_response_seconds: FirstResponseDTO
    duration_seconds: MedianDTO
    message_count: MedianDTO
    after_hours_attempts: int
    topics: list[AnalyticsBucketDTO]
    outcomes: list[AnalyticsBucketDTO]
    confidence_avg: float | None
    series: list[AnalyticsDayDTO]
    suppression_threshold: int
