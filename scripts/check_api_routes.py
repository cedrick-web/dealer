from collections import Counter
from pathlib import Path
import re
import sys

source = Path(__file__).resolve().parents[1] / "backend" / "bin" / "server.dart"
text = source.read_text(encoding="utf-8")
pattern = re.compile(r"""r\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]""")
routes = [(method.upper(), path) for method, path in pattern.findall(text)]
counts = Counter(routes)
duplicates = sorted(route for route, count in counts.items() if count > 1)

required = {
    ("GET", "/health"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/me/notifications"),
    ("POST", "/api/v1/listings"),
    ("PATCH", "/api/v1/me/listings/<id>"),
    ("POST", "/api/v1/me/listings/<id>/withdraw"),
    ("GET", "/api/v1/agents"),
    ("POST", "/api/v1/agents/apply"),
    ("GET", "/api/v1/admin/agents/pending"),
    ("PATCH", "/api/v1/admin/agents/<id>/review"),
    ("POST", "/api/v1/conversations/<id>/messages"),
    ("POST", "/api/v1/deals"),
    ("GET", "/api/v1/trust/verify/<hash>"),
}
missing = sorted(required - set(routes))

if duplicates:
    print("Duplicate HTTP route registrations:")
    for route in duplicates:
        print(f"  {route[0]} {route[1]}")
if missing:
    print("Required HTTP routes missing:")
    for route in missing:
        print(f"  {route[0]} {route[1]}")
if duplicates or missing:
    sys.exit(1)

print(f"Route contract OK: {len(routes)} unique HTTP route registrations checked.")
