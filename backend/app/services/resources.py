from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.resource import Resource, ResourceTag
from app.schemas.resources import ResourceDTO, ResourceTagDTO
from app.seed import register


def list_resources(
    db: Session, tag: str | None = None, unc: bool | None = None
) -> list[ResourceDTO]:
    """Published resources by display order then name, optionally filtered by tag name or UNC."""
    query = (
        select(Resource)
        .where(Resource.is_published)
        .options(selectinload(Resource.tags))
        .order_by(Resource.display_order, Resource.name)
    )
    if tag is not None:
        query = query.where(Resource.tags.any(ResourceTag.name == tag))
    if unc is not None:
        query = query.where(Resource.is_unc == unc)
    return [
        ResourceDTO(
            id=resource.id,
            name=resource.name,
            description=resource.description,
            url=resource.url,
            phone=resource.phone,
            is_unc=resource.is_unc,
            is_crisis=resource.is_crisis,
            tags=[resource_tag.name for resource_tag in resource.tags],
        )
        for resource in db.scalars(query)
    ]


def list_tags(db: Session) -> list[ResourceTagDTO]:
    query = select(ResourceTag).order_by(ResourceTag.display_order, ResourceTag.name)
    return [ResourceTagDTO.model_validate(resource_tag) for resource_tag in db.scalars(query)]


# Local dev only: Peer2Peer confirms the real listings, numbers, and links.
SEED_RESOURCES: list[dict[str, Any]] = [
    {
        "name": "911",
        "description": "Call 911 if you or someone else is in immediate danger.",
        "phone": "911",
        "is_crisis": True,
        "is_published": True,
        "display_order": 0,
        "tags": ["Crisis/Urgent"],
    },
    {
        "name": "988 Suicide & Crisis Lifeline",
        "description": "Free, confidential support 24/7 by call or text.",
        "url": "https://988lifeline.org",
        "phone": "988",
        "is_crisis": True,
        "is_published": True,
        "display_order": 1,
        "tags": ["Crisis/Urgent"],
    },
    {
        "name": "Crisis Text Line",
        "description": "Text HOME to 741741 to reach a trained crisis counselor 24/7.",
        "url": "https://www.crisistextline.org",
        "phone": "741741",
        "is_published": True,
        "display_order": 2,
        "tags": ["Crisis/Urgent"],
    },
    {
        "name": "The Trevor Project",
        "description": "24/7 crisis support for LGBTQ+ young people.",
        "url": "https://www.thetrevorproject.org",
        "phone": "1-866-488-7386",
        "is_published": True,
        "display_order": 3,
        "tags": ["Crisis/Urgent", "Peer & Community"],
    },
    {
        "name": "UNC Counseling and Psychological Services (CAPS)",
        "description": "Counseling, crisis support, and referrals for UNC students.",
        "url": "https://caps.unc.edu",
        "phone": "919-966-3658",
        "is_unc": True,
        "is_crisis": True,
        "is_published": True,
        "display_order": 4,
        "tags": ["Crisis/Urgent", "Ongoing Care"],
    },
    {
        # Unpublished, like a UNC resource that hasn't agreed to be listed yet.
        "name": "UNC Student Wellness",
        "description": "Wellness programs and peer education for UNC students.",
        "url": "https://studentwellness.unc.edu",
        "is_unc": True,
        "display_order": 5,
        "tags": ["Ongoing Care", "Training"],
    },
]


@register
def seed_resources(db: Session) -> None:
    # The migration inserts the starting tags, so look them up by name.
    tags = {resource_tag.name: resource_tag for resource_tag in db.scalars(select(ResourceTag))}
    existing = set(db.scalars(select(Resource.name)))
    for seed in SEED_RESOURCES:
        if seed["name"] not in existing:
            fields = {key: value for key, value in seed.items() if key != "tags"}
            db.add(Resource(**fields, tags=[tags[name] for name in seed["tags"]]))
    db.flush()
