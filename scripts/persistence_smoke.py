#!/usr/bin/env python3
"""Verify MongoDB-backed marketplace state survives an API container restart."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080")
STATE_FILE = "/tmp/dealer-persistence-state.json"


def call(method, path, token=None, body=None, expected=200):
    headers = {"Authorization": "Bearer " + token} if token else {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            status, payload = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read()
    assert status == expected, (
        f"{method} {path}: expected {expected}, got {status}: {payload[:400]!r}"
    )
    return json.loads(payload) if payload else {}


def prepare():
    import uuid
    run = uuid.uuid4().hex[:12]
    registered = call("POST", "/api/v1/auth/register", body={
        "name": "Persistence CI Owner",
        "email": f"ci-persistence-{run}@example.test",
        "password": "CI_Test_Password_12345",
        "phone": "+250780000055",
    }, expected=201)
    token = registered["token"]
    listing = call("POST", "/api/v1/listings", token, {
        "title": "Persistence restart check " + run,
        "description": "A published listing used to prove MongoDB state survives API restart.",
        "propertyType": "house",
        "purpose": "sale",
        "location": {"district": "Gasabo", "sector": "Kinyinya"},
        "price": {"amount": 175000000, "currency": "RWF", "period": "once"},
    }, expected=201)
    listing_id = listing["id"]
    admin = call("POST", "/api/v1/auth/login", body={
        "email": os.environ["BOOTSTRAP_ADMIN_EMAIL"],
        "password": os.environ["BOOTSTRAP_ADMIN_PASSWORD"],
    })["token"]
    published = call("PATCH", f"/api/v1/admin/listings/{listing_id}/review", admin, {
        "decision": "approve",
        "note": "Published for API restart persistence verification.",
    })
    assert published["status"] == "published"
    with open(STATE_FILE, "w", encoding="utf-8") as state:
        json.dump({"token": token, "listing_id": listing_id}, state)
    print("PASS: created and published a MongoDB-backed listing before API restart.")


def verify():
    with open(STATE_FILE, encoding="utf-8") as state:
        saved = json.load(state)
    listing_id, token = saved["listing_id"], saved["token"]
    public_listing = call("GET", f"/api/v1/listings/{listing_id}")["data"]
    assert public_listing["status"] == "published", "Published listing state was not retained after API restart."
    owner_listings = call("GET", "/api/v1/me/listings", token)["data"]
    owned = next((item for item in owner_listings if item["publicId"] == listing_id), None)
    assert owned is not None, "Listing ownership record was not retained after API restart."
    assert owned["status"] == "published", "Owner listing status changed after API restart."
    assert owned["title"] == public_listing["title"], "Listing content changed after API restart."
    print("PASS: published listing, owner association, title, and lifecycle state survived API container restart.")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"prepare", "verify"}:
        raise SystemExit("Usage: persistence_smoke.py prepare|verify")
    prepare() if sys.argv[1] == "prepare" else verify()
