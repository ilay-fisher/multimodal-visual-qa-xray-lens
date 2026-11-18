"""VLM clients (demo, local OpenAI-compatible, cloud) plus prompt building and parsing."""

import asyncio
import base64
import hashlib
import json
import logging
import math
import re
import time
from collections.abc import AsyncIterator
from typing import Any, Protocol

import cv2
import numpy as np
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.config import Settings
from app.cv_pipeline import PAIR_GAP, PAIR_GAP_COLOR
from app.schemas import DefectReport, Severity

logger = logging.getLogger(__name__)


class VLMError(Exception):
    """Transport or configuration failure."""


class VLMOutputError(VLMError):
    """The model output is not a valid DefectReport."""


class VLMClient(Protocol):
    """Interface every backend implements: stream raw JSON text chunks."""

    name: str

    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]: ...


# domain -> ["category|allowed severities|evidence|action"]; the demo picks one by hash.
RULES = {
    "pcb": [
        "missing_component|high critical|Part missing on the right; only bare pads remain.|"
        "Reflow, place part.",
        "solder_bridge|medium high|A bright metal blob now bridges two adjacent pads.|"
        "Remove bridge, re-inspect.",
    ],
    "aerial": [
        "irrigation_stress|medium high|Vegetation turned yellow-brown versus the baseline.|"
        "Check irrigation lines.",
        "pest_damage|low medium|The canopy is thinner and speckled versus the baseline.|"
        "Scout and treat locally.",
    ],
    "ui": [
        "clipped_element|medium high|Element is cut off in the target but whole in the baseline.|"
        "Fix overflow or sizing.",
        "misalignment|low medium|The element sits off its neighbors' grid versus the baseline.|"
        "Restore the alignment.",
    ],
    "generic": ["visual_anomaly|low medium high|The region differs from the baseline.|Review."],
}


def build_prompt(domain_context: str) -> str:
    """Build the strict JSON-only instruction prompt for a domain."""
    rules = RULES.get(domain_context.strip().lower(), [])
    typical = "; ".join(f"{r.split('|')[0]} ({r.split('|')[2]})" for r in rules)
    hint = (
        f"Domain: {domain_context or 'generic'}. Typical defects: {typical or 'any visual anomaly'}"
    )
    severities = ", ".join(s.value for s in Severity)
    return (
        "You are a visual inspection assistant. The image shows one region of interest twice, "
        "separated by a gray gap: the LEFT half is the expected baseline and the RIGHT half is "
        "the current target. Describe what changed from left to right, including anything "
        f"that is missing on the right or newly present. {hint}\n"
        "Reply with ONE JSON object and nothing else: no prose, no markdown, no code fences.\n"
        'Schema: {"defect_category": str (1-64 chars, snake_case), '
        f'"severity": one of [{severities}], "confidence": float 0..1, '
        '"visual_evidence": str (max 500 chars), "recommended_action": str (max 300 chars)}\n'
        "No other keys."
    )


def parse_report(raw: str) -> DefectReport:
    """Extract the first JSON object from model text and validate it strictly."""
    text = re.sub(r"```(?:json)?", "", raw)
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = json.JSONDecoder().raw_decode(text, match.start())
        except json.JSONDecodeError:
            continue
        try:
            return DefectReport.model_validate(obj)
        except ValidationError as exc:
            detail = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
            logger.warning("VLM output failed schema validation: %s", detail)
            raise VLMOutputError(f"invalid report: {detail}") from exc
    logger.warning("VLM output contained no JSON object (%d chars)", len(raw))
    raise VLMOutputError("no valid JSON object found in model output")


def estimate_image_tokens(width: int, height: int) -> int:
    """Estimate image tokens with the Anthropic heuristic ceil(w*h/750), minimum 1."""
    return max(1, math.ceil(width * height / 750))


class DemoVLMClient:
    """Deterministic, network-free client: image stats and a content hash pick the defect."""

    name = "demo"
    delay_s = 0.015

    @staticmethod
    def _split(img: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
        """Return (baseline, target) halves of a composite, or None when there is no gap."""
        half, odd = divmod(img.shape[1] - PAIR_GAP, 2)
        gap = img[:, half : half + PAIR_GAP].astype(int)
        if half < 1 or odd or np.abs(gap - PAIR_GAP_COLOR).max() > 2:
            return None
        return img[:, :half], img[:, half + PAIR_GAP :]

    @staticmethod
    def _stats(img: np.ndarray) -> dict[str, float]:
        """Cheap pixel fractions: dark body, bright metal, yellow/brown, foreground."""
        hue, sat, val = np.moveaxis(cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(float), 2, 0)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(float)
        return {
            "dark": float((val < 70).mean()),
            "metal": float(((sat < 60) & (val > 170)).mean()),
            "yellow": float(((hue > 8) & (hue < 35) & (sat > 80)).mean()),
            "fg": float((abs(gray - np.median(gray)) > 40).mean()),
        }

    def _classify(self, key: str, pair: tuple[np.ndarray, np.ndarray]) -> str | None:
        """Pick a category by comparing baseline and target halves; None for unknown domains."""
        a, b = self._stats(pair[0]), self._stats(pair[1])
        d = {k: b[k] - a[k] for k in a}
        if key == "pcb":
            return "solder_bridge" if d["metal"] > -d["dark"] else "missing_component"
        if key == "aerial":
            return "irrigation_stress" if d["yellow"] > 0.2 else "pest_damage"
        if key == "ui":
            return "clipped_element" if d["fg"] < -0.1 else "misalignment"
        return None

    def _report(self, image_png: bytes, domain_context: str) -> DefectReport:
        key = domain_context.strip().lower()
        seed = int.from_bytes(hashlib.sha256(image_png + b"|" + key.encode()).digest()[:8], "big")
        img = cv2.imdecode(np.frombuffer(image_png, np.uint8), cv2.IMREAD_COLOR)
        pair = self._split(img) if img is not None else None
        edge = float((cv2.Canny(img, 100, 200) > 0).mean()) if img is not None else 0.0
        rules = RULES.get(key, RULES["generic"])
        chosen = f"{self._classify(key, pair) if pair else None}|"
        rule = next((r for r in rules if r.startswith(chosen)), rules[seed % len(rules)])
        category, sevs, evidence, action = rule.split("|")
        severity = sevs.split()[(seed >> 16) % len(sevs.split())]
        conf = 0.55 + 0.42 * (0.6 * min(edge * 4, 1.0) + 0.4 * ((seed >> 8) % 100) / 100)
        return DefectReport(
            defect_category=category,
            severity=Severity(severity),
            confidence=round(min(max(conf, 0.55), 0.97), 2),
            visual_evidence=evidence,
            recommended_action=action,
        )

    async def _chunks(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
        payload = self._report(image_png, domain_context).model_dump_json()
        for i in range(0, len(payload), 12):
            await asyncio.sleep(self.delay_s)
            yield payload[i : i + 12]

    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
        return _guarded(self.name, self._chunks(image_png, domain_context))


async def _guarded(name: str, stream: AsyncIterator[str]) -> AsyncIterator[str]:
    """Yield chunks, logging timing and wrapping SDK failures into VLMError."""
    logger.info("VLM call start backend=%s", name)
    started = time.perf_counter()
    try:
        async for chunk in stream:
            yield chunk
    except VLMError:
        raise
    except Exception as exc:
        # Tracebacks only at DEBUG: provider 401 messages may echo key fragments.
        logger.error(
            "VLM call failed backend=%s error=%s",
            name,
            type(exc).__name__,
            exc_info=logger.isEnabledFor(logging.DEBUG),
        )
        raise VLMError(f"{name} request failed: {type(exc).__name__}") from exc
    elapsed = (time.perf_counter() - started) * 1e3
    logger.info("VLM call end backend=%s elapsed_ms=%.1f", name, elapsed)


async def _openai_stream(client: Any, model: str, png: bytes, ctx: str) -> AsyncIterator[str]:
    url = "data:image/png;base64," + base64.b64encode(png).decode()
    content = [
        {"type": "text", "text": build_prompt(ctx)},
        {"type": "image_url", "image_url": {"url": url}},
    ]
    stream = await client.chat.completions.create(
        model=model,
        stream=True,
        temperature=0,
        max_tokens=600,
        messages=[{"role": "user", "content": content}],
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


class LocalVLMClient:
    """Client for an OpenAI-compatible local server (oMLX, Ollama, vLLM)."""

    name = "local"

    def __init__(self, settings: Settings) -> None:
        self.model = settings.local_vlm_model
        self._client = AsyncOpenAI(
            base_url=settings.local_vlm_base_url,
            api_key=settings.local_vlm_api_key.get_secret_value(),
            timeout=settings.vlm_timeout_s,
        )

    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
        inner = _openai_stream(self._client, self.model, image_png, domain_context)
        return _guarded(self.name, inner)


class CloudVLMClient:
    """Hosted VLM client using the Anthropic or OpenAI SDK."""

    def __init__(self, settings: Settings) -> None:
        self.provider = settings.cloud_provider
        self.name = f"cloud:{self.provider}"
        anthropic = self.provider == "anthropic"
        key = settings.anthropic_api_key if anthropic else settings.openai_api_key
        if key is None or not key.get_secret_value():
            raise VLMError(f"{self.provider.upper()}_API_KEY is required for cloud mode")
        self.model = settings.anthropic_model if anthropic else settings.openai_model
        sdk = AsyncAnthropic if anthropic else AsyncOpenAI
        self._client: Any = sdk(api_key=key.get_secret_value(), timeout=settings.vlm_timeout_s)

    async def _anthropic_stream(self, png: bytes, ctx: str) -> AsyncIterator[str]:
        source = {
            "type": "base64",
            "media_type": "image/png",
            "data": base64.b64encode(png).decode(),
        }
        content = [
            {"type": "image", "source": source},
            {"type": "text", "text": build_prompt(ctx)},
        ]
        async with self._client.messages.stream(
            model=self.model,
            max_tokens=600,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]:
        if self.provider == "anthropic":
            inner = self._anthropic_stream(image_png, domain_context)
        else:
            inner = _openai_stream(self._client, self.model, image_png, domain_context)
        return _guarded(self.name, inner)


def get_vlm_client(mode: str, settings: Settings) -> VLMClient:
    """Return the client for demo, local or cloud mode; raise VLMError otherwise."""
    if mode == "demo":
        return DemoVLMClient()
    if mode in ("local", "cloud"):
        return (LocalVLMClient if mode == "local" else CloudVLMClient)(settings)
    raise VLMError(f"unknown VLM mode: {mode!r}")
