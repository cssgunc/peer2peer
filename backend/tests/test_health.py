from fastapi.testclient import TestClient


def test_health_reports_ok_when_database_reachable(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
