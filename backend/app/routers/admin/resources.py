import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.errors import AppError
from app.models import Account
from app.models.resource import Resource, ResourceTag
from app.schemas.resources import (
    AdminResourceDTO,
    AdminResourceTagDTO,
    ResourceInputDTO,
    ResourcePatchDTO,
    ResourceTagInputDTO,
    ResourceTagPatchDTO,
)
from app.services.audit import AuditAction, record_audit

router = APIRouter(prefix="/admin", tags=["admin resources"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


def get_resource(db: Session, id: uuid.UUID) -> Resource:
    item = db.get(Resource, id)
    if item is None:
        raise HTTPException(404, "Resource not found")
    return item


def get_tag(db: Session, id: uuid.UUID) -> ResourceTag:
    item = db.get(ResourceTag, id)
    if item is None:
        raise HTTPException(404, "Resource tag not found")
    return item


def resolve_tags(db: Session, ids: list[uuid.UUID]) -> list[ResourceTag]:
    tags = list(
        db.scalars(
            select(ResourceTag)
            .where(ResourceTag.id.in_(ids))
            .order_by(ResourceTag.display_order, ResourceTag.name)
        )
    )
    if len(tags) != len(set(ids)):
        raise HTTPException(422, "tag_ids: Resource tag not found")
    return tags


def save_tag(db: Session) -> None:
    # The unique constraint also handles concurrent attempts to claim the same name.
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise AppError(409, "tag_exists", "A tag with this name already exists") from None
        raise


@router.get("/resources", response_model=list[AdminResourceDTO])
def list_resources(db: Database, actor: Coordinator):
    return db.scalars(
        select(Resource)
        .options(selectinload(Resource.tags))
        .order_by(Resource.display_order, Resource.name, Resource.id)
    ).all()


@router.post("/resources", response_model=AdminResourceDTO, status_code=201)
def create_resource(data: ResourceInputDTO, db: Database, actor: Coordinator):
    tags = resolve_tags(db, data.tag_ids)
    item = Resource(**data.model_dump(exclude={"tag_ids"}), tags=tags)
    db.add(item)
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_CREATE,
        target_type="resource",
        target_id=item.id,
    )
    db.commit()
    return item


@router.patch("/resources/{id}", response_model=AdminResourceDTO)
def update_resource(id: uuid.UUID, data: ResourcePatchDTO, db: Database, actor: Coordinator):
    item = get_resource(db, id)
    values = data.model_dump(exclude_unset=True)
    try:
        ResourceInputDTO.model_validate(
            {
                **{
                    field: getattr(item, field)
                    for field in ResourceInputDTO.model_fields
                    if field != "tag_ids"
                },
                **values,
            }
        )
    except ValidationError:
        raise HTTPException(422, "A resource needs a URL or phone number") from None
    tags = resolve_tags(db, values["tag_ids"]) if "tag_ids" in values else None
    for field, value in values.items():
        if field != "tag_ids":
            setattr(item, field, value)
    if tags is not None:
        item.tags = tags
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_UPDATE,
        target_type="resource",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item


@router.delete("/resources/{id}", status_code=204)
def delete_resource(id: uuid.UUID, db: Database, actor: Coordinator) -> Response:
    item = get_resource(db, id)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_DELETE,
        target_type="resource",
        target_id=item.id,
    )
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/resource-tags", response_model=list[AdminResourceTagDTO])
def list_tags(db: Database, actor: Coordinator):
    return db.scalars(
        select(ResourceTag).order_by(ResourceTag.display_order, ResourceTag.name)
    ).all()


@router.post("/resource-tags", response_model=AdminResourceTagDTO, status_code=201)
def create_tag(data: ResourceTagInputDTO, db: Database, actor: Coordinator):
    item = ResourceTag(**data.model_dump())
    db.add(item)
    save_tag(db)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_TAG_CREATE,
        target_type="resource_tag",
        target_id=item.id,
    )
    db.commit()
    return item


@router.patch("/resource-tags/{id}", response_model=AdminResourceTagDTO)
def update_tag(id: uuid.UUID, data: ResourceTagPatchDTO, db: Database, actor: Coordinator):
    item = get_tag(db, id)
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(item, field, value)
    save_tag(db)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_TAG_UPDATE,
        target_type="resource_tag",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item


@router.delete("/resource-tags/{id}", status_code=204)
def delete_tag(id: uuid.UUID, db: Database, actor: Coordinator) -> Response:
    item = get_tag(db, id)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.RESOURCE_TAG_DELETE,
        target_type="resource_tag",
        target_id=item.id,
    )
    db.delete(item)
    db.commit()
    return Response(status_code=204)
