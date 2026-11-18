"""Central logging setup (stdlib only).

This is the only module allowed to configure the root logger. It offers a JSON
formatter for production and a readable single-line formatter for development.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

# Set by the HTTP layer per request; included in every log line when present.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

# Marks the handler installed by this module so repeated calls can replace it.
_HANDLER_FLAG = "_xray_managed"

# Attributes present on every LogRecord; anything else came from `extra=`.
_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}

_NOISY_LOGGERS = ("httpx", "httpcore", "openai", "anthropic")


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in record.__dict__.items() if k not in _STANDARD_ATTRS}


class JsonFormatter(logging.Formatter):
    """Format records as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            payload["request_id"] = request_id
        payload.update(_extra_fields(record))
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    """Format records as a readable single line (exceptions are flattened)."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=UTC).strftime("%H:%M:%S")
        parts = [ts, f"{record.levelname:<7}", record.name]
        request_id = request_id_var.get()
        if request_id is not None:
            parts.append(f"[{request_id}]")
        parts.append(record.getMessage())
        parts.extend(f"{k}={v}" for k, v in _extra_fields(record).items())
        line = " ".join(parts)
        if record.exc_info:
            line += " | " + self.formatException(record.exc_info).replace("\n", " | ")
        return line


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Configure the root logger. Safe to call more than once."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, _HANDLER_FLAG, False):
            root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(ConsoleFormatter() if fmt == "console" else JsonFormatter())
    setattr(handler, _HANDLER_FLAG, True)
    root.addHandler(handler)
    root.setLevel(level.upper())

    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
