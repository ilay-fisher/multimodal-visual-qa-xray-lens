"""Tests for app.logging_config (JSON and console logging, request id contextvar)."""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator

import pytest

from app.logging_config import ConsoleFormatter, JsonFormatter, configure_logging, request_id_var

REQUIRED_KEYS = {"ts", "level", "logger", "msg"}


@pytest.fixture(autouse=True)
def _restore_root_logger() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)
    request_id_var.set(None)


def _managed_handlers() -> list[logging.StreamHandler[object]]:
    """Handlers installed by configure_logging (pytest adds its own capture handlers)."""
    return [
        h
        for h in logging.getLogger().handlers
        if isinstance(h, logging.StreamHandler)
        and isinstance(h.formatter, JsonFormatter | ConsoleFormatter)
    ]


def _capture(fmt: str = "json", level: str = "INFO") -> io.StringIO:
    """Configure logging and redirect the managed handler to an in-memory stream."""
    configure_logging(level=level, fmt=fmt)
    stream = io.StringIO()
    handlers = _managed_handlers()
    assert len(handlers) == 1
    handlers[0].setStream(stream)
    return stream


def _last_json(stream: io.StringIO) -> dict[str, object]:
    lines = [line for line in stream.getvalue().splitlines() if line.strip()]
    assert lines, "no log output captured"
    parsed = json.loads(lines[-1])
    assert isinstance(parsed, dict)
    return parsed


def test_json_output_has_required_keys() -> None:
    stream = _capture()
    logging.getLogger("app.test").info("hello %s", "world")
    record = _last_json(stream)
    assert set(record) >= REQUIRED_KEYS
    assert record["msg"] == "hello world"
    assert record["level"] == "INFO"
    assert record["logger"] == "app.test"
    ts = str(record["ts"])
    assert "T" in ts
    assert ts.endswith("+00:00") or ts.endswith("Z")


def test_request_id_from_contextvar_appears() -> None:
    stream = _capture()
    token = request_id_var.set("req-123")
    try:
        logging.getLogger("app.test").info("with id")
    finally:
        request_id_var.reset(token)
    assert _last_json(stream)["request_id"] == "req-123"


def test_request_id_absent_when_unset() -> None:
    stream = _capture()
    logging.getLogger("app.test").info("no id")
    assert "request_id" not in _last_json(stream)


def test_extra_fields_appear() -> None:
    stream = _capture()
    logging.getLogger("app.test").info("extra", extra={"roi_count": 3, "backend": "demo"})
    record = _last_json(stream)
    assert record["roi_count"] == 3
    assert record["backend"] == "demo"


def test_exception_text_included() -> None:
    stream = _capture()
    try:
        raise ValueError("boom")
    except ValueError:
        logging.getLogger("app.test").error("failed", exc_info=True)
    record = _last_json(stream)
    assert "ValueError" in str(record["exc_info"])
    assert "boom" in str(record["exc_info"])


def test_idempotent_single_handler() -> None:
    configure_logging()
    configure_logging(level="DEBUG", fmt="console")
    assert len(_managed_handlers()) == 1


def test_level_is_applied() -> None:
    stream = _capture(level="WARNING")
    logging.getLogger("app.test").info("hidden")
    logging.getLogger("app.test").warning("shown")
    assert "hidden" not in stream.getvalue()
    assert "shown" in stream.getvalue()


def test_console_format_is_not_json() -> None:
    stream = _capture(fmt="console")
    request_id_var.set("abc")
    logging.getLogger("app.test").info("plain line")
    lines = stream.getvalue().strip().splitlines()
    assert len(lines) == 1
    assert "plain line" in lines[0]
    assert "INFO" in lines[0]
    with pytest.raises(json.JSONDecodeError):
        json.loads(lines[0])


def test_noisy_libraries_set_to_warning() -> None:
    configure_logging()
    for name in ("httpx", "openai", "anthropic"):
        assert logging.getLogger(name).level == logging.WARNING
    assert logging.getLogger("uvicorn.access").level != logging.WARNING
