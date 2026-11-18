"""Shared fixtures: an API client with fresh guard state and a fast demo VLM."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.vlm_client import DemoVLMClient


@pytest.fixture(autouse=True)
def fast_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the artificial streaming delay of the demo VLM."""
    monkeypatch.setattr(DemoVLMClient, "delay_s", 0.0)


@pytest.fixture
def make_settings() -> type[Settings]:
    """Settings class that ignores any local .env file."""

    class IsolatedSettings(Settings):
        model_config = {**Settings.model_config, "env_file": None}

    return IsolatedSettings


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, make_settings: type[Settings]) -> Iterator[TestClient]:
    """TestClient (lifespan active) with demo settings and fresh cache/limiter/budget."""
    from app import main

    monkeypatch.setattr(main, "settings", make_settings(vlm_mode="demo"))
    monkeypatch.setattr(main, "cache", main.ResponseCache(256))
    monkeypatch.setattr(main, "limiter", main.RateLimiter())
    monkeypatch.setattr(main, "budget", main.DailyBudget())
    with TestClient(main.app) as test_client:
        yield test_client
