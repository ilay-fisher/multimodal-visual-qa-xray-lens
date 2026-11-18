"""Spoofed X-Forwarded-For from an untrusted peer must not change the rate-limit client key."""

import httpx
import pytest
from fastapi import FastAPI, Request
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware


def make_app(trusted: str) -> ProxyHeadersMiddleware:
    app = FastAPI()

    @app.get("/ip")
    async def ip(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    return ProxyHeadersMiddleware(app, trusted_hosts=trusted)


async def client_ip(trusted: str, peer: str) -> str:
    transport = httpx.ASGITransport(make_app(trusted), client=(peer, 1234))
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
        return (await http.get("/ip", headers={"X-Forwarded-For": "6.6.6.6"})).json()


@pytest.mark.asyncio
async def test_untrusted_peer_cannot_spoof_its_ip() -> None:
    assert await client_ip("127.0.0.1", "203.0.113.9") == "203.0.113.9"


@pytest.mark.asyncio
async def test_trusted_proxy_forwarded_ip_is_used() -> None:
    assert await client_ip("*", "172.18.0.3") == "6.6.6.6"
