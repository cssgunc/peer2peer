import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.errors import AppError, register_exception_handlers


class Msg(BaseModel):
    body: str = Field(max_length=2000)


router = APIRouter()


@router.get("/app-error")
def app_error():
    raise AppError(418, "teapot", "short and stout")


@router.get("/http/{status}")
def http_error(status: int):
    raise HTTPException(status_code=status)


@router.post("/validate")
def validate(msg: Msg):
    return {}


@router.get("/boom")
def boom():
    raise RuntimeError("secret internal info")


app = FastAPI()
register_exception_handlers(app)
app.include_router(router)
# raise_server_exceptions=False so the 500 handler's response is returned, not re-raised
client = TestClient(app, raise_server_exceptions=False)


def test_app_error():
    r = client.get("/app-error")
    assert r.status_code == 418
    assert r.json() == {"detail": "short and stout", "code": "teapot"}


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "not_authenticated"),
        (403, "forbidden"),
        (404, "not_found"),
        (409, "conflict"),
        (429, "rate_limited"),
    ],
)
def test_http_exception_default_codes(status, code):
    r = client.get(f"/http/{status}")
    assert r.status_code == status
    assert r.json()["code"] == code


def test_unknown_route_uses_error_format():
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


def test_validation_error():
    r = client.post("/validate", json={"body": "x" * 2001})
    assert r.status_code == 422
    assert r.json() == {
        "detail": "body: String should have at most 2000 characters",
        "code": "validation_error",
    }


def test_unhandled_exception_hides_internals():
    r = client.get("/boom")
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error", "code": "internal_error"}
    assert "secret internal info" not in r.text
