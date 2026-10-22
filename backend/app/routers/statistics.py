from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.statistic import Statistic
from app.schemas.statistics import StatisticDTO

router = APIRouter(prefix="/statistics", tags=["statistics"])


@router.get("", response_model=list[StatisticDTO])
def list_statistics(db: Annotated[Session, Depends(get_db)]):
    return db.scalars(
        select(Statistic)
        .where(Statistic.is_published.is_(True))
        .order_by(Statistic.display_order, Statistic.id)
    ).all()
