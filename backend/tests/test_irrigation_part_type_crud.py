"""ResourcePack/IrrigationPartType CRUD (#251) - the real drip-irrigation
part catalog for IrrigationPart.part_type, grouped into toggleable resource
packs (e.g. "Gardena"), same "seeded lookup, matched by normalized string,
not a hard FK against IrrigationPart" spirit as EquipmentType/
BedEquipment.equipment_type, but IrrigationPartType does carry a hard FK to
its owning ResourcePack."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_pack(client: TestClient, name: str = "Gardena", is_active: bool = True) -> dict:
    response = client.post("/api/resource-packs", json={"name": name, "is_active": is_active})
    assert response.status_code == 201, response.text
    return response.json()


def _t_junction_payload(resource_pack_id: int) -> dict:
    return {
        "resource_pack_id": resource_pack_id,
        "slug": "gardena_t_junction_13mm",
        "name": "Gardena 13mm T-Junction",
        "connection_count": 3,
        "part_number": "8365",
        "icon_key": "t_junction",
    }


def test_resource_pack_crud_round_trip(client: TestClient) -> None:
    pack = _create_pack(client)
    pack_id = pack["id"]
    assert pack["name"] == "Gardena"
    assert pack["is_active"] is True

    update_response = client.patch(f"/api/resource-packs/{pack_id}", json={"is_active": False})
    assert update_response.status_code == 200
    assert update_response.json()["is_active"] is False

    list_response = client.get("/api/resource-packs")
    assert any(p["id"] == pack_id for p in list_response.json())

    delete_response = client.delete(f"/api/resource-packs/{pack_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/resource-packs/{pack_id}").status_code == 404


def test_duplicate_resource_pack_name_is_409(client: TestClient) -> None:
    _create_pack(client)
    response = client.post("/api/resource-packs", json={"name": "Gardena", "is_active": True})
    assert response.status_code == 409


def test_irrigation_part_type_crud_round_trip(client: TestClient) -> None:
    pack = _create_pack(client)
    create_response = client.post("/api/irrigation-part-types", json=_t_junction_payload(pack["id"]))
    assert create_response.status_code == 201, create_response.text
    part_type = create_response.json()
    part_type_id = part_type["id"]
    assert part_type["connection_count"] == 3
    assert part_type["part_number"] == "8365"

    update_response = client.patch(
        f"/api/irrigation-part-types/{part_type_id}", json={"connection_count": 4}
    )
    assert update_response.status_code == 200
    assert update_response.json()["connection_count"] == 4

    delete_response = client.delete(f"/api/irrigation-part-types/{part_type_id}")
    assert delete_response.status_code == 204
    assert client.get(f"/api/irrigation-part-types/{part_type_id}").status_code == 404


def test_get_missing_irrigation_part_type_404(client: TestClient) -> None:
    assert client.get("/api/irrigation-part-types/999999").status_code == 404


def test_irrigation_part_type_requires_valid_resource_pack_409(client: TestClient) -> None:
    response = client.post("/api/irrigation-part-types", json=_t_junction_payload(999999))
    assert response.status_code == 409


def test_list_irrigation_part_types_excludes_inactive_packs_by_default(client: TestClient) -> None:
    active_pack = _create_pack(client, name="Gardena", is_active=True)
    inactive_pack = _create_pack(client, name="Some Other Brand", is_active=False)

    active_payload = _t_junction_payload(active_pack["id"])
    inactive_payload = {**_t_junction_payload(inactive_pack["id"]), "slug": "other_brand_t_junction"}
    active_created = client.post("/api/irrigation-part-types", json=active_payload).json()
    inactive_created = client.post("/api/irrigation-part-types", json=inactive_payload).json()

    default_list = client.get("/api/irrigation-part-types").json()
    default_ids = {p["id"] for p in default_list}
    assert active_created["id"] in default_ids
    assert inactive_created["id"] not in default_ids

    full_list = client.get("/api/irrigation-part-types", params={"include_inactive": True}).json()
    full_ids = {p["id"] for p in full_list}
    assert active_created["id"] in full_ids
    assert inactive_created["id"] in full_ids


def test_irrigation_part_free_text_part_type_still_works_unmatched(client: TestClient) -> None:
    """#251's own test criterion 4: an IrrigationPart with a part_type string
    that has no matching IrrigationPartType row must still work - this
    catalog is additive, never a hard FK against IrrigationPart itself."""
    response = client.post(
        "/api/irrigation-parts",
        json={
            "name": "Mystery connector",
            "part_type": "some_exotic_unmatched_type",
            "quantity_on_hand": 2,
            "notes": "",
            "connector_size_mm": None,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["part_type"] == "some_exotic_unmatched_type"
