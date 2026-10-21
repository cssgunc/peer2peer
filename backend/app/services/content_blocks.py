from dataclasses import dataclass
from types import MappingProxyType

from sqlalchemy.orm import Session

from app.models.content_block import ContentBlock
from app.schemas.content import ContentBlockDTO

PLACEHOLDER_BODY = "Placeholder: Peer2Peer will write this section."


@dataclass(frozen=True)
class ContentBlockDefinition:
    title: str
    description: str
    public: bool = True
    body_md: str = PLACEHOLDER_BODY


CONTENT_BLOCKS = MappingProxyType(
    {
        "home.intro": ContentBlockDefinition(
            title="Welcome to Peer2Peer",
            description="Introduce the line and explain what it is and is not.",
        ),
        "home.how-it-works": ContentBlockDefinition(
            title="How It Works",
            description="Explain how students connect with a peer responder and what to expect.",
        ),
        "home.what-is-peer-support": ContentBlockDefinition(
            title="What Is Peer Support?",
            description="Describe peer support and the role of a peer responder.",
        ),
        "about.history": ContentBlockDefinition(
            title="Our History",
            description="Share the history of Peer2Peer at UNC.",
        ),
        "about.pillars": ContentBlockDefinition(
            title="Our Pillars",
            description="Explain the principles that guide Peer2Peer support.",
        ),
        "about.training": ContentBlockDefinition(
            title="Responder Training",
            description="Describe how responders are trained to support students.",
        ),
        "text-us.intro": ContentBlockDefinition(
            title="Text Us",
            description="Introduce texting the line and explain how to get started.",
        ),
        "chat.notice": ContentBlockDefinition(
            title="Before You Chat",
            description="Show students this notice before they send their first chat message.",
        ),
        "chat.after-hours": ContentBlockDefinition(
            title="After Hours",
            description="Auto-reply when closed; keep {next_open} for the next opening time.",
            body_md=PLACEHOLDER_BODY + " Next opening: {next_open}.",
        ),
        "portal.guide": ContentBlockDefinition(
            title="Responder Guide",
            description="Provide the escalation protocol and resource guide for responders.",
            public=False,
        ),
    }
)


def get_block(db: Session, slug: str) -> ContentBlockDTO:
    """Return saved content or its default; unregistered slugs raise KeyError."""
    definition = CONTENT_BLOCKS[slug]
    stored = db.get(ContentBlock, slug)
    if stored is not None:
        return ContentBlockDTO.model_validate(stored)
    return ContentBlockDTO(
        slug=slug,
        title=definition.title,
        body_md=definition.body_md,
        updated_at=None,
    )
