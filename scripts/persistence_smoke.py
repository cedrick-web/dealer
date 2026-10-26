#!/usr/bin/env python3
"""Verify marketplace listings, evidence reviews, notifications and audit records survive an API restart."""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080")
STATE_FILE = "/tmp/dealer-persistence-state.json"


def call(method, path, token=None, body=None, expected=200, raw=False):
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
    if raw:
        return payload
    return json.loads(payload) if payload else {}


def prepare():
    run = uuid.uuid4().hex[:12]
    registered = call("POST", "/api/v1/auth/register", body={
        "name": "Persistence CI Owner",
        "email": f"ci-persistence-{run}@example.test",
        "password": "CI_Test_Password_12345",
        "phone": "+250780000055",
    }, expected=201)
    token = registered["token"]
    title = "Persistence restart check " + run
    listing = call("POST", "/api/v1/listings", token, {
        "title": title,
        "description": "A published listing used to prove MongoDB state survives API restart.",
        "propertyType": "house",
        "purpose": "sale",
        "location": {"district": "Gasabo", "sector": "Kinyinya"},
        "price": {"amount": 175000000, "currency": "RWF", "period": "once"},
    }, expected=201)
    listing_id = listing["id"]
    buyer = call("POST", "/api/v1/auth/register", body={
        "name": "Persistence CI Buyer",
        "email": f"ci-persistence-buyer-{run}@example.test",
        "password": "CI_Test_Password_12345",
    }, expected=201)
    buyer_token = buyer["token"]

    # A harmless CI-only PDF fixture tests the metadata, review state, hash and
    # notification/audit records without uploading anyone's real documents.
    pdf = b"%PDF-1.4\n% CI persistence fixture\n"
    document = call("POST", f"/api/v1/listings/{listing_id}/documents", token, {
        "fileName": "persistence-ci.pdf",
        "contentType": "application/pdf",
        "base64": __import__("base64").b64encode(pdf).decode(),
    }, expected=201)
    document_id = document["data"]["publicId"]
    digest = document["sha256"]
    assert document["status"] == "pending_review"

    admin = call("POST", "/api/v1/auth/login", body={
        "email": os.environ["BOOTSTRAP_ADMIN_EMAIL"],
        "password": os.environ["BOOTSTRAP_ADMIN_PASSWORD"],
    })["token"]

    changed = call("PATCH", f"/api/v1/admin/documents/{document_id}/review", admin, {
        "decision": "request_changes",
        "note": "CI persistence check: please provide a clearer scan.",
    })
    assert changed["status"] == "changes_requested"
    reviewed = call("PATCH", f"/api/v1/admin/documents/{document_id}/review", admin, {
        "decision": "approve",
        "note": "CI persistence check: readable test fixture.",
    })
    assert reviewed["status"] == "verified"

    published = call("PATCH", f"/api/v1/admin/listings/{listing_id}/review", admin, {
        "decision": "approve",
        "note": "Published for API restart persistence verification.",
    })
    assert published["status"] == "published"

    with open(STATE_FILE, "w", encoding="utf-8") as state:
        json.dump({
            "owner_token": token,
            "buyer_token": buyer_token,
            "admin_token": admin,
            "listing_id": listing_id,
            "document_id": document_id,
            "evidence_hash": digest,
            "title": title,
        }, state)
    print("PASS: created and published a listing and approved a CI-only evidence fixture before API restart.")


def verify():
    with open(STATE_FILE, encoding="utf-8") as state:
        saved = json.load(state)
    listing_id = saved["listing_id"]
    document_id = saved["document_id"]
    digest = saved["evidence_hash"]
    owner_token = saved["owner_token"]
    buyer_token = saved["buyer_token"]
    admin_token = saved["admin_token"]

    public_listing = call("GET", f"/api/v1/listings/{listing_id}")["data"]
    assert public_listing["status"] == "published", "Published listing state was not retained after API restart."
    assert public_listing["title"] == saved["title"], "Published listing title changed after API restart."
    owner_listings = call("GET", "/api/v1/me/listings", owner_token)["data"]
    owned = next((item for item in owner_listings if item["publicId"] == listing_id), None)
    assert owned is not None, "Listing ownership record was not retained after API restart."
    assert owned["status"] == "published", "Owner listing status changed after API restart."

    docs = call("GET", f"/api/v1/listings/{listing_id}/documents", owner_token)["data"]
    evidence = next((item for item in docs if item["publicId"] == document_id), None)
    assert evidence is not None, "Evidence metadata was not retained after API restart."
    assert evidence["reviewStatus"] == "verified", "Evidence review state was not retained after API restart."

    downloaded = call("GET", f"/api/v1/documents/{document_id}/download", owner_token, raw=True)
    assert downloaded.startswith(b"%PDF-1.4"), "Private evidence bytes were not retained after API restart."
    call("GET", f"/api/v1/listings/{listing_id}/documents", buyer_token, expected=403)
    call("GET", f"/api/v1/documents/{document_id}/download", buyer_token, expected=403)

    verification = call("GET", f"/api/v1/trust/verify/{digest}")
    assert verification["exists"] is True, "Evidence digest index lookup failed after API restart."

    audit = call("GET", "/api/v1/admin/audit?type=document.reviewed&limit=100", admin_token)["data"]
    matching = [event for event in audit if event.get("subjectId") == document_id]
    assert any(event.get("decision") == "request_changes" and event.get("evidenceHash") == digest for event in matching), (
        "Request-changes audit event or its evidence digest was not retained after API restart."
    )
    assert any(
        event.get("decision") == "approve"
        and event.get("evidenceHash") == digest
        and event.get("note") == "CI persistence check: readable test fixture."
        for event in matching
    ), "Approval audit event, review note or evidence digest was not retained after API restart."

    notices = call("GET", "/api/v1/me/notifications", owner_token)["data"]
    assert any(
        item.get("title") == "Evidence review updated"
        and document_id == item.get("subjectId")
        and "readable test fixture" in item.get("body", "")
        for item in notices
    ), "Evidence-review notification was not retained after API restart."

    print("PASS: listing ownership/content/status, private evidence bytes and access controls, evidence review state, digest lookup, both audit decisions and owner notification survived API restart.")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"prepare", "verify"}:
        raise SystemExit("Usage: persistence_smoke.py prepare|verify")
    prepare() if sys.argv[1] == "prepare" else verify()
