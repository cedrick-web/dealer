#!/usr/bin/env python3
"""Disposable-MongoDB end-to-end smoke test for Dealer's high-risk API workflows."""
import base64
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080")
RUN_ID = uuid.uuid4().hex[:12]


def request(method, path, *, token=None, body=None, expected=200, raw=False):
    headers = {}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            status, payload = response.status, response.read()
    except urllib.error.HTTPError as exc:
        status, payload = exc.code, exc.read()
    assert status == expected, f"{method} {path}: expected HTTP {expected}, got {status}: {payload[:500]!r}"
    if raw:
        return payload
    if not payload:
        return {}
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AssertionError(f"{method} {path}: expected JSON response") from exc


def register(label):
    result = request("POST", "/api/v1/auth/register", expected=201, body={
        "name": "CI " + label,
        "email": f"ci-{label.lower()}-{RUN_ID}@example.test",
        "password": "CI_Test_Password_12345",
        "phone": "+250780000000",
    })
    assert result.get("token"), "Registration must return a session token"
    return result["token"], result["user"]["publicId"]


def main():
    health = request("GET", "/health")
    assert health.get("status") == "ok" and health.get("database") == "connected"

    owner_token, owner_id = register("Owner")
    buyer_token, buyer_id = register("Buyer")
    admin = request("POST", "/api/v1/auth/login", expected=200, body={
        "email": os.environ["BOOTSTRAP_ADMIN_EMAIL"],
        "password": os.environ["BOOTSTRAP_ADMIN_PASSWORD"],
    })
    admin_token = admin["token"]

    listing = request("POST", "/api/v1/listings", token=owner_token, expected=201, body={
        "title": "CI workflow property " + RUN_ID,
        "description": "A temporary test property used only to verify the complete API workflow.",
        "propertyType": "house",
        "purpose": "sale",
        "location": {"district": "Gasabo", "sector": "Kinyinya"},
        "price": {"amount": 185000000, "currency": "RWF", "period": "once"},
    })
    listing_id = listing["id"]
    assert listing["status"] == "pending_review"
    request("GET", f"/api/v1/listings/{listing_id}", expected=404)

    # Exercise signature validation and persistent private/public file handling using
    # minimal signature-valid fixtures. These are not real documents or photographs.
    tiny_png = bytes([137, 80, 78, 71, 13, 10, 26, 10]) + b"CI"
    image = request("POST", f"/api/v1/me/listings/{listing_id}/images",
                    token=owner_token, expected=201, body={
        "fileName": "ci-fixture.png", "altText": "CI fixture image",
        "contentType": "image/png", "base64": base64.b64encode(tiny_png).decode(),
    })
    image_id = image["data"]["publicId"]
    assert image["status"] == "pending_review"

    pdf = b"%PDF-1.4\n% CI-only test fixture\n"
    document = request("POST", f"/api/v1/listings/{listing_id}/documents",
                       token=owner_token, expected=201, body={
        "fileName": "ci-fixture.pdf", "contentType": "application/pdf",
        "base64": base64.b64encode(pdf).decode(),
    })
    document_id = document["id"]
    evidence_hash = document["evidenceHash"]
    assert evidence_hash

    request("GET", f"/api/v1/listings/{listing_id}/documents", token=buyer_token, expected=403)
    request("GET", f"/api/v1/documents/{document_id}/download", token=buyer_token, expected=403)
    request("GET", f"/api/v1/documents/{document_id}/download", expected=401)

    reviewed = request("PATCH", f"/api/v1/admin/listings/{listing_id}/review",
                       token=admin_token, body={
        "decision": "approve", "note": "CI runtime smoke approval only",
    })
    assert reviewed["status"] == "published"
    public_listing = request("GET", f"/api/v1/listings/{listing_id}")
    assert public_listing["data"]["status"] == "published"
    request("GET", f"/api/v1/listing-images/{image_id}", raw=True)
    trust = request("GET", f"/api/v1/trust/verify/{evidence_hash}")
    assert trust.get("exists") is True

    saved = request("PUT", f"/api/v1/favorites/{listing_id}", token=buyer_token)
    assert saved.get("saved") is True
    assert any(x.get("listingId") == listing_id for x in request("GET", "/api/v1/me/favorites", token=buyer_token)["data"])

    lead = request("POST", "/api/v1/leads", token=buyer_token, expected=201, body={
        "listingId": listing_id, "type": "viewing",
        "message": "Please arrange a viewing for this property.",
        "preferredAt": "2026-11-03T14:00:00Z",
    })["data"]
    assert lead["status"] == "open"

    conversation = request("POST", "/api/v1/conversations", token=buyer_token, expected=201,
                           body={"listingId": listing_id})["data"]
    conversation_id = conversation["publicId"]
    message = request("POST", f"/api/v1/conversations/{conversation_id}/messages",
                      token=buyer_token, expected=201,
                      body={"text": "Hello, I would like to arrange a viewing."})["data"]
    assert message["text"]
    owner_threads = request("GET", "/api/v1/me/conversations", token=owner_token)["data"]
    assert any(thread["publicId"] == conversation_id for thread in owner_threads)
    request("POST", f"/api/v1/conversations/{conversation_id}/messages",
            token=owner_token, expected=201, body={"text": "Thank you. Let us coordinate a time."})
    assert len(request("GET", f"/api/v1/conversations/{conversation_id}/messages",
                       token=buyer_token)["data"]) == 2
    request("GET", f"/api/v1/conversations/{conversation_id}/messages",
            token=admin_token, expected=404)

    application = request("POST", "/api/v1/agents/apply", token=buyer_token, expected=201, body={
        "phone": "+250780000001",
        "bio": "CI test profile describing professional property support and local market experience.",
        "experienceYears": 2, "districts": ["Gasabo", "Kicukiro"], "showPhone": False,
    })["data"]
    application_id = application["publicId"]
    pending = request("GET", "/api/v1/admin/agents/pending", token=admin_token)["data"]
    assert any(row["publicId"] == application_id for row in pending)
    approval = request("PATCH", f"/api/v1/admin/agents/{application_id}/review",
                       token=admin_token, body={"decision": "approve", "note": "CI approval"})
    assert approval["status"] == "approved"
    assert any(row["publicId"] == application_id for row in request("GET", "/api/v1/agents")["data"])

    deal = request("POST", "/api/v1/deals", token=buyer_token, expected=201, body={
        "listingId": listing_id, "commissionPercent": 3,
        "commissionTerms": "CI-only proposed commission terms for workflow testing.",
    })["data"]
    deal_id = deal["publicId"]
    request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=buyer_token,
            expected=409, body={"stage": "agreement"})
    accepted = request("POST", f"/api/v1/deals/{deal_id}/accept-fee", token=owner_token)
    assert accepted.get("fullyAccepted") is True
    request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=buyer_token, body={"stage": "viewing"})
    request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=buyer_token, body={"stage": "offer"})
    request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=buyer_token, body={"stage": "agreement"})
    first = request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=buyer_token,
                    body={"stage": "completed"})
    assert first.get("completionPending") is True
    final = request("PATCH", f"/api/v1/deals/{deal_id}/stage", token=owner_token,
                    body={"stage": "completed"})
    assert final.get("stage") == "completed"

    # A deal participant can access listing evidence; unrelated users cannot.
    docs = request("GET", f"/api/v1/listings/{listing_id}/documents", token=buyer_token)["data"]
    assert any(row["publicId"] == document_id for row in docs)
    downloaded = request("GET", f"/api/v1/documents/{document_id}/download",
                         token=buyer_token, raw=True)
    assert downloaded.startswith(b"%PDF")
    request("GET", "/api/v1/me/notifications", token=owner_token)
    request("GET", "/api/v1/me/notifications", token=buyer_token)
    print("PASS: listing moderation, image/document storage and access controls, evidence hash, favourites, viewing lead, private messaging, agent review, commission acknowledgements, deal milestones and two-party completion.")


if __name__ == "__main__":
    main()
