from datetime import datetime

from pydantic import BaseModel


class StatusDTO(BaseModel):
    is_online: bool
    next_open_at: datetime | None
    line_launched: bool
    line_launch_at: datetime | None
