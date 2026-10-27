from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.faq import Faq
from app.schemas.faqs import FaqDTO

router = APIRouter(prefix="/faqs", tags=["faqs"])


@router.get("", response_model=list[FaqDTO])
def list_faqs(db: Annotated[Session, Depends(get_db)]):
    return db.scalars(
        select(Faq).where(Faq.is_published.is_(True)).order_by(Faq.display_order, Faq.id)
    ).all()
