"""Full CRUD round trip for /api/decorations, plus the 404 contract and
rectangle<->polygon border_geometry round-trips (#241 - same shape as
test_bed_crud.py, minus any cascade-delete concerns since nothing
references a Decoration row)."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import rectangle

pytestmark = pytest.mark.integration


def test_get_missing_decoration_404(client: TestClient) -> None:
    response = client.get("/api/decorations/999999")
    assert response.status_code == 404


def test_decoration_crud_round_trip(client: TestClient) -> None:
    create_response = client.post(
        "/api/decorations",
        json={
            "name": "Garden bench",
            "border_geometry": rectangle(width=40, height=100),
            "notes": "Weathered oak",
        },
    )
    assert create_response.status_code == 201, create_response.text
    decoration = create_response.json()
    assert decoration["name"] == "Garden bench"
    assert decoration["color"] == "#78716c"  # default neutral stone-gray swatch
    assert decoration["border_geometry"]["type"] == "rectangle"
    decoration_id = decoration["id"]

    get_response = client.get(f"/api/decorations/{decoration_id}")
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Garden bench"

    list_response = client.get("/api/decorations")
    assert list_response.status_code == 200
    assert any(d["id"] == decoration_id for d in list_response.json())

    update_response = client.patch(
        f"/api/decorations/{decoration_id}", json={"color": "#ff0000", "notes": "Repainted red"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["color"] == "#ff0000"
    assert update_response.json()["notes"] == "Repainted red"
    # Untouched fields survive a partial PATCH.
    assert update_response.json()["name"] == "Garden bench"

    update_geometry_response = client.patch(
        f"/api/decorations/{decoration_id}",
        json={"border_geometry": rectangle(width=50, height=110)},
    )
    assert update_geometry_response.status_code == 200
    assert update_geometry_response.json()["border_geometry"]["width"] == 50

    delete_response = client.delete(f"/api/decorations/{decoration_id}")
    assert delete_response.status_code == 204

    assert client.get(f"/api/decorations/{decoration_id}").status_code == 404


def test_decoration_border_geometry_polygon_round_trip(client: TestClient) -> None:
    polygon = {
        "type": "polygon",
        "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 50, "y": 100}],
    }
    create_response = client.post(
        "/api/decorations",
        json={"name": "Triangular flower bed border", "border_geometry": polygon},
    )
    assert create_response.status_code == 201, create_response.text
    assert create_response.json()["border_geometry"] == polygon

    decoration_id = create_response.json()["id"]
    get_response = client.get(f"/api/decorations/{decoration_id}")
    assert get_response.json()["border_geometry"] == polygon
