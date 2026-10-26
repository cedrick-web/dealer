#!/usr/bin/env python3
"""End-to-end API smoke test against the disposable MongoDB used in CI."""
import base64, json, os, urllib.error, urllib.request, uuid

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080")
RUN = uuid.uuid4().hex[:12]

def call(method, path, token=None, body=None, expected=200, raw=False):
    headers = {"Authorization": "Bearer " + token} if token else {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            status, payload = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, payload = err.code, err.read()
    assert status == expected, f"{method} {path}: expected {expected}, got {status}: {payload[:400]!r}"
    if raw:
        return payload
    return json.loads(payload) if payload else {}

def register(label):
    out = call("POST", "/api/v1/auth/register", expected=201, body={
        "name": "CI " + label, "email": f"ci-{label.lower()}-{RUN}@example.test",
        "password": "CI_Test_Password_12345", "phone": "+250780000000"})
    return out["token"], out["user"]["publicId"]

def main():
    health = call("GET", "/health")
    assert health["status"] == "ok" and health["database"] == "connected"
    owner_token, _ = register("Owner")
    buyer_token, _ = register("Buyer")
    profile = call("PATCH", "/api/v1/me/profile", owner_token,
                   {"name": "CI Owner Updated", "phone": "+250780000099"})
    assert profile["user"]["name"] == "CI Owner Updated"
    admin = call("POST", "/api/v1/auth/login", expected=200, body={
        "email": os.environ["BOOTSTRAP_ADMIN_EMAIL"],
        "password": os.environ["BOOTSTRAP_ADMIN_PASSWORD"]})["token"]

    call("GET", "/api/v1/admin/audit", owner_token, expected=403)
    audit_feed = call("GET", "/api/v1/admin/audit?limit=10", admin)
    assert isinstance(audit_feed["data"], list) and audit_feed["limit"] == 10
    call("GET", "/api/v1/admin/audit?limit=1000", admin)
    call("GET", "/api/v1/admin/audit?limit=0", admin)

    listing = call("POST", "/api/v1/listings", owner_token, {
        "title": "CI property " + RUN,
        "description": "Temporary test listing used to validate real API workflows.",
        "propertyType": "house", "purpose": "sale",
        "location": {"district": "Gasabo", "sector": "Kinyinya"},
        "price": {"amount": 185000000, "currency": "RWF", "period": "once"}}, 201)
    listing_id = listing["id"]
    assert listing["status"] == "pending_review"
    call("GET", f"/api/v1/listings/{listing_id}", expected=404)

    png = bytes([137,80,78,71,13,10,26,10]) + b"CI"
    photo = call("POST", f"/api/v1/me/listings/{listing_id}/images", owner_token, {
        "fileName": "ci.png", "altText": "CI fixture", "contentType": "image/png",
        "base64": base64.b64encode(png).decode()}, 201)
    photo_id = photo["data"]["publicId"]
    pdf = b"%PDF-1.4\n% CI-only fixture\n"
    document = call("POST", f"/api/v1/listings/{listing_id}/documents", owner_token, {
        "fileName": "ci.pdf", "contentType": "application/pdf",
        "base64": base64.b64encode(pdf).decode()}, 201)
    document_id, digest = document["data"]["publicId"], document["sha256"]
    assert document["status"] == "pending_review"
    owner_docs_before_review = call("GET", f"/api/v1/listings/{listing_id}/documents", owner_token)["data"]
    assert next(x for x in owner_docs_before_review if x["publicId"] == document_id)["reviewStatus"] == "not_reviewed"
    call("GET", f"/api/v1/listings/{listing_id}/documents", buyer_token, expected=403)
    call("GET", f"/api/v1/documents/{document_id}/download", buyer_token, expected=403)
    call("GET", f"/api/v1/documents/{document_id}/download", expected=401)
    call("PATCH", f"/api/v1/admin/documents/{document_id}/review", owner_token,
         {"decision": "approve", "note": "Must be administrator-only"}, 403)
    changed = call("PATCH", f"/api/v1/admin/documents/{document_id}/review", admin,
                   {"decision": "request_changes", "note": "Please provide a clearer scan."})
    assert changed["status"] == "changes_requested"
    verified = call("PATCH", f"/api/v1/admin/documents/{document_id}/review", admin,
                    {"decision": "approve", "note": "Readable document received."})
    assert verified["status"] == "verified"
    audit_after_review = call("GET", "/api/v1/admin/audit?type=document.reviewed&limit=100", admin)["data"]
    assert any(e.get("subjectId") == document_id and e.get("decision") == "approve" and e.get("evidenceHash") == digest
               for e in audit_after_review), "Admin audit feed must preserve the evidence review decision and upload digest."
    owner_notices = call("GET", "/api/v1/me/notifications", owner_token)["data"]
    assert any(n["title"] == "Evidence review updated" and "ci.pdf" in n.get("body", "")
               for n in owner_notices), "Document review must notify the listing owner."
    assert call("GET", f"/api/v1/trust/verify/{digest}")["exists"] is True
    call("PATCH", f"/api/v1/admin/documents/{document_id}/review", admin,
         {"decision": "unknown", "note": ""}, 422)

    rejected = call("PATCH", f"/api/v1/admin/listings/{listing_id}/review", admin, {
        "decision": "reject", "note": "CI rejection used to verify owner resubmission."})
    assert rejected["status"] == "rejected"
    owner_listings = call("GET", "/api/v1/me/listings", owner_token)["data"]
    assert next(x for x in owner_listings if x["publicId"] == listing_id)["status"] == "rejected"
    revised_input = {
        "title": "CI resubmitted property " + RUN,
        "description": "Revised listing submitted after an administrator rejection for lifecycle testing.",
        "propertyType": "house", "purpose": "sale",
        "location": {"district": "Gasabo", "sector": "Kinyinya"},
        "price": {"amount": 186000000, "currency": "RWF", "period": "once"}}
    call("PATCH", f"/api/v1/me/listings/{listing_id}", buyer_token, revised_input, 404)
    resubmitted = call("PATCH", f"/api/v1/me/listings/{listing_id}", owner_token, revised_input)
    assert resubmitted["status"] == "pending_review"
    assert any(x["publicId"] == listing_id for x in call("GET", "/api/v1/admin/listings/pending", admin)["data"])
    reviewed = call("PATCH", f"/api/v1/admin/listings/{listing_id}/review", admin, {
        "decision": "approve", "note": "CI-only approval after owner resubmission"})
    assert reviewed["status"] == "published"
    assert call("GET", f"/api/v1/listings/{listing_id}")["data"]["status"] == "published"
    call("GET", f"/api/v1/listing-images/{photo_id}", raw=True)
    assert call("GET", f"/api/v1/trust/verify/{digest}")["exists"] is True

    assert call("PUT", f"/api/v1/favorites/{listing_id}", buyer_token)["saved"] is True
    assert any(x["listingId"] == listing_id for x in call("GET", "/api/v1/me/favorites", buyer_token)["data"])
    lead = call("POST", "/api/v1/leads", buyer_token, {
        "listingId": listing_id, "type": "viewing",
        "message": "Please arrange a viewing for this property.",
        "preferredAt": "2026-11-03T14:00:00Z"}, 201)["data"]
    assert lead["status"] == "open"

    room = call("POST", "/api/v1/conversations", buyer_token, {"listingId": listing_id}, 201)["data"]
    room_id = room["publicId"]
    call("POST", f"/api/v1/conversations/{room_id}/messages", buyer_token,
         {"text": "I would like to arrange a viewing."}, 201)
    assert any(x["publicId"] == room_id for x in call("GET", "/api/v1/me/conversations", owner_token)["data"])
    call("POST", f"/api/v1/conversations/{room_id}/messages", owner_token,
         {"text": "Thank you. Let us coordinate a time."}, 201)
    assert len(call("GET", f"/api/v1/conversations/{room_id}/messages", buyer_token)["data"]) == 2
    call("GET", f"/api/v1/conversations/{room_id}/messages", admin, expected=404)

    application = call("POST", "/api/v1/agents/apply", buyer_token, {
        "phone": "+250780000001",
        "bio": "CI profile describing property support and local market experience for prospective clients.",
        "experienceYears": 2, "districts": ["Gasabo", "Kicukiro"], "showPhone": False}, 201)["data"]
    app_id = application["publicId"]
    assert any(x["publicId"] == app_id for x in call("GET", "/api/v1/admin/agents/pending", admin)["data"])
    assert call("PATCH", f"/api/v1/admin/agents/{app_id}/review", admin,
                {"decision": "approve", "note": "CI approval"})["status"] == "approved"
    assert any(x["publicId"] == app_id for x in call("GET", "/api/v1/agents")["data"])

    deal = call("POST", "/api/v1/deals", buyer_token, {
        "listingId": listing_id, "commissionPercent": 3,
        "commissionTerms": "CI-only proposed commission terms for workflow testing."}, 201)["data"]
    deal_id = deal["publicId"]
    call("PATCH", f"/api/v1/deals/{deal_id}/stage", buyer_token,
         {"stage": "agreement"}, 409)
    assert call("POST", f"/api/v1/deals/{deal_id}/accept-fee", owner_token)["fullyAccepted"] is True
    for stage in ("viewing", "offer", "agreement"):
        call("PATCH", f"/api/v1/deals/{deal_id}/stage", buyer_token, {"stage": stage})
    pending = call("PATCH", f"/api/v1/deals/{deal_id}/stage", buyer_token, {"stage": "completed"})
    assert pending["completionPending"] is True
    completed = call("PATCH", f"/api/v1/deals/{deal_id}/stage", owner_token, {"stage": "completed"})
    assert completed["stage"] == "completed"

    docs = call("GET", f"/api/v1/listings/{listing_id}/documents", buyer_token)["data"]
    assert any(x["publicId"] == document_id for x in docs)
    assert next(x for x in docs if x["publicId"] == document_id)["reviewStatus"] == "verified"
    assert call("GET", f"/api/v1/documents/{document_id}/download", buyer_token, raw=True).startswith(b"%PDF")
    call("GET", "/api/v1/me/notifications", owner_token)
    call("GET", "/api/v1/me/notifications", buyer_token)

    # Withdrawal is an owner-only terminal lifecycle state. It must disappear
    # from public search and must not be silently resurrected by editing.
    call("POST", f"/api/v1/me/listings/{listing_id}/withdraw", buyer_token, {}, 404)
    withdrawn = call("POST", f"/api/v1/me/listings/{listing_id}/withdraw", owner_token, {})
    assert withdrawn["status"] == "withdrawn"
    owner_after_withdraw = call("GET", "/api/v1/me/listings", owner_token)["data"]
    assert next(x for x in owner_after_withdraw if x["publicId"] == listing_id)["status"] == "withdrawn"
    call("GET", f"/api/v1/listings/{listing_id}", expected=404)
    call("PATCH", f"/api/v1/me/listings/{listing_id}", owner_token, revised_input, 409)
    call("POST", f"/api/v1/me/listings/{listing_id}/withdraw", owner_token, {}, 409)
    print("PASS: listing moderation and resubmission, terminal withdrawal, image and private document storage/access, evidence hash, favourites, viewing leads, private messaging, agent review, commission acceptance and two-party deal completion.")

if __name__ == "__main__":
    main()
