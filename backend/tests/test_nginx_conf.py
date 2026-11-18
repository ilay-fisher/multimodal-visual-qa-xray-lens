"""Static checks on the edge rate-limit configuration in frontend/nginx.conf.

nginx is not available in the test environment, so these tests only assert that the
required directives are present and wired to the right locations. Behaviour is
verified manually against the compose stack (see the PR test plan).
"""

import re
from pathlib import Path

CONF = (Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text()


def zones(kind: str) -> dict[str, str]:
    """Map zone name -> full directive text for limit_req_zone / limit_conn_zone."""
    pattern = rf"^\s*{kind}\s+(\S+)\s+zone=(\w+):[^;]+;"
    return {m.group(2): m.group(0) for m in re.finditer(pattern, CONF, re.M)}


def location_block(selector: str) -> str:
    """Return the body of the first `location ... {` whose header contains `selector`."""
    match = re.search(
        r"location\s+[^{]*" + re.escape(selector) + r"[^{]*\{(.*?)\n    \}", CONF, re.S
    )
    assert match, f"no location containing {selector!r}"
    return match.group(1)


def test_request_zones_keyed_on_client_ip() -> None:
    req = zones("limit_req_zone")
    assert len(req) >= 2, "need a strict zone and a loose zone"
    assert all("$binary_remote_addr" in d for d in req.values())


def test_strict_zone_is_stricter_than_loose_zone() -> None:
    def per_minute(directive: str) -> int:
        rate = re.search(r"rate=(\d+)r/([sm])", directive)
        assert rate
        return int(rate.group(1)) * (60 if rate.group(2) == "s" else 1)

    req = zones("limit_req_zone")
    rates = sorted(per_minute(d) for d in req.values())
    assert rates[0] < rates[-1]


def test_expensive_endpoints_use_strict_zone() -> None:
    req = zones("limit_req_zone")
    strict = min(req, key=lambda n: int(re.search(r"rate=(\d+)", req[n]).group(1)))  # type: ignore[union-attr]
    for endpoint in ("/api/inspect", "/api/analyze-roi"):
        body = location_block(endpoint)
        assert f"limit_req zone={strict}" in body, endpoint


def test_generic_api_uses_loose_zone() -> None:
    req = zones("limit_req_zone")
    loose = max(req, key=lambda n: int(re.search(r"rate=(\d+)", req[n]).group(1)))  # type: ignore[union-attr]
    assert f"limit_req zone={loose}" in location_block("/api/")


def test_connection_limit_per_ip() -> None:
    conn = zones("limit_conn_zone")
    assert conn and all("$binary_remote_addr" in d for d in conn.values())
    assert re.search(r"limit_conn\s+\w+\s+\d+;", CONF)


def test_rejections_return_429() -> None:
    assert re.search(r"limit_req_status\s+429;", CONF)
    assert re.search(r"limit_conn_status\s+429;", CONF)
