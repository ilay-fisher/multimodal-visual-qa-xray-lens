"""Tests for prompt building, parsing, and the demo/local/cloud VLM clients (no network)."""

import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any, ClassVar, Self

import cv2
import numpy as np
import pytest

from app import vlm_client
from app.config import Settings
from app.schemas import DefectReport
from app.vlm_client import (
    CloudVLMClient,
    DemoVLMClient,
    LocalVLMClient,
    VLMError,
    VLMOutputError,
    build_prompt,
    estimate_image_tokens,
    get_vlm_client,
    parse_report,
)

GOOD = {
    "defect_category": "solder_bridge",
    "severity": "medium",
    "confidence": 0.8,
    "visual_evidence": "Two pads joined.",
    "recommended_action": "Rework the joint.",
}


def make_png(seed: int = 0, size: tuple[int, int] = (64, 48)) -> bytes:
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 255, (size[1], size[0], 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def collect(client: Any, png: bytes, ctx: str) -> list[str]:
    return [c async for c in client.stream_analyze(png, ctx)]


def _fast_demo() -> DemoVLMClient:
    client = DemoVLMClient()
    client.delay_s = 0
    return client


def settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)


# ---------------------------------------------------------------- parse / prompt


def test_parse_plain_json() -> None:
    assert parse_report(json.dumps(GOOD)).defect_category == "solder_bridge"


def test_parse_fenced_json() -> None:
    raw = "```json\n" + json.dumps(GOOD) + "\n```"
    assert isinstance(parse_report(raw), DefectReport)


def test_parse_prose_around_json_with_braces_in_strings() -> None:
    data = {**GOOD, "visual_evidence": "Odd {brace} in text"}
    raw = f"Sure! Here is the report: {json.dumps(data)} Hope that helps {{not json}}"
    assert parse_report(raw).visual_evidence == "Odd {brace} in text"


@pytest.mark.parametrize("raw", ["", "no json here", "{not valid json", "{'a': 1}"])
def test_parse_rejects_invalid_json(raw: str) -> None:
    with pytest.raises(VLMOutputError):
        parse_report(raw)


def test_parse_rejects_schema_violation() -> None:
    with pytest.raises(VLMOutputError, match="severity"):
        parse_report(json.dumps({**GOOD, "severity": "extreme"}))


def test_output_error_is_vlm_error() -> None:
    assert issubclass(VLMOutputError, VLMError)


def test_build_prompt_contents() -> None:
    prompt = build_prompt("pcb")
    for word in ("JSON", "defect_category", "confidence", "critical", "solder"):
        assert word in prompt
    assert "irrigation" in build_prompt("aerial")
    assert "clipped" in build_prompt("ui")
    assert "custom thing" in build_prompt("custom thing")


def test_estimate_image_tokens() -> None:
    assert estimate_image_tokens(960, 640) == 820
    assert estimate_image_tokens(750, 1) == 1
    assert estimate_image_tokens(751, 1) == 2
    assert estimate_image_tokens(0, 0) == 1


# ---------------------------------------------------------------- demo


@pytest.mark.asyncio
async def test_demo_deterministic() -> None:
    png = make_png(1)
    a = "".join(await collect(DemoVLMClient(), png, "pcb"))
    b = "".join(await collect(DemoVLMClient(), png, "pcb"))
    assert a == b


@pytest.mark.asyncio
async def test_demo_stream_valid_and_chunked() -> None:
    chunks = await collect(DemoVLMClient(), make_png(2), "aerial")
    assert len(chunks) > 3
    report = parse_report("".join(chunks))
    assert 0.55 <= report.confidence <= 0.97


@pytest.mark.asyncio
async def test_demo_varies_by_domain() -> None:
    png = make_png(3)
    cats = {}
    for ctx in ("pcb", "aerial", "ui", "something else"):
        report = parse_report("".join(await collect(DemoVLMClient(), png, ctx)))
        cats[ctx] = report.defect_category
    assert cats["pcb"] in {"missing_component", "solder_bridge"}
    assert cats["aerial"] in {"irrigation_stress", "pest_damage"}
    assert cats["ui"] in {"clipped_element", "misalignment"}
    assert len(set(cats.values())) >= 3


@pytest.mark.asyncio
async def test_demo_always_parses_across_inputs() -> None:
    for seed in range(8):
        for ctx in ("pcb", "aerial", "ui", "", "free text"):
            parse_report("".join(await collect(_fast_demo(), make_png(seed), ctx)))


@pytest.mark.asyncio
async def test_demo_handles_undecodable_bytes() -> None:
    parse_report("".join(await collect(DemoVLMClient(), b"not an image", "pcb")))


# ---------------------------------------------------------------- factory


def test_factory_modes() -> None:
    assert get_vlm_client("demo", settings()).name == "demo"
    assert get_vlm_client("local", settings(local_vlm_api_key="k")).name == "local"
    s = settings(anthropic_api_key="sk-a")
    assert get_vlm_client("cloud", s).name == "cloud:anthropic"
    s = settings(cloud_provider="openai", openai_api_key="sk-o")
    assert get_vlm_client("cloud", s).name == "cloud:openai"


def test_factory_cloud_without_key_raises() -> None:
    with pytest.raises(VLMError, match="ANTHROPIC_API_KEY"):
        get_vlm_client("cloud", settings())
    with pytest.raises(VLMError, match="OPENAI_API_KEY"):
        get_vlm_client("cloud", settings(cloud_provider="openai"))


def test_factory_unknown_mode_raises() -> None:
    with pytest.raises(VLMError):
        get_vlm_client("bogus", settings())


# ---------------------------------------------------------------- fakes


def oa_chunk(text: str | None) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])


class FakeOpenAI:
    instances: ClassVar[list["FakeOpenAI"]] = []
    fail = False

    def __init__(self, **kwargs: Any) -> None:
        self.init = kwargs
        self.calls: list[dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        FakeOpenAI.instances.append(self)

    async def _create(self, **kwargs: Any) -> AsyncIterator[SimpleNamespace]:
        self.calls.append(kwargs)
        if FakeOpenAI.fail:
            raise RuntimeError("boom")

        async def gen() -> AsyncIterator[SimpleNamespace]:
            yield oa_chunk("{")
            yield SimpleNamespace(choices=[])  # keep-alive chunk without choices
            yield oa_chunk(None)
            yield oa_chunk('"a": 1}')

        return gen()


class FakeAnthropicStream:
    def __init__(self, parts: list[str]) -> None:
        self.parts = parts

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    @property
    def text_stream(self) -> AsyncIterator[str]:
        async def gen() -> AsyncIterator[str]:
            for p in self.parts:
                yield p

        return gen()


class FakeAnthropic:
    instances: ClassVar[list["FakeAnthropic"]] = []

    def __init__(self, **kwargs: Any) -> None:
        self.init = kwargs
        self.calls: list[dict[str, Any]] = []
        self.messages = SimpleNamespace(stream=self._stream)
        FakeAnthropic.instances.append(self)

    def _stream(self, **kwargs: Any) -> FakeAnthropicStream:
        self.calls.append(kwargs)
        return FakeAnthropicStream(["{", '"b": 2}'])


@pytest.fixture(autouse=True)
def _patch_sdks(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeOpenAI.instances.clear()
    FakeOpenAI.fail = False
    FakeAnthropic.instances.clear()
    monkeypatch.setattr(vlm_client, "AsyncOpenAI", FakeOpenAI)
    monkeypatch.setattr(vlm_client, "AsyncAnthropic", FakeAnthropic)


# ---------------------------------------------------------------- local


@pytest.mark.asyncio
async def test_local_request_shape_and_chunks() -> None:
    s = settings(
        local_vlm_base_url="http://x.test/v1",
        local_vlm_model="m1",
        local_vlm_api_key="k1",
        vlm_timeout_s=7,
    )
    png = make_png()
    chunks = await collect(LocalVLMClient(s), png, "pcb")
    assert chunks == ["{", '"a": 1}']
    fake = FakeOpenAI.instances[0]
    assert fake.init["base_url"] == "http://x.test/v1"
    assert fake.init["api_key"] == "k1"
    assert fake.init["timeout"] == 7
    call = fake.calls[0]
    assert call["model"] == "m1"
    assert call["stream"] is True
    assert call["temperature"] == 0
    content = call["messages"][-1]["content"]
    url = next(p["image_url"]["url"] for p in content if p["type"] == "image_url")
    assert url.startswith("data:image/png;base64,")
    assert any(p["type"] == "text" and "JSON" in p["text"] for p in content)


@pytest.mark.asyncio
async def test_local_wraps_sdk_errors() -> None:
    FakeOpenAI.fail = True
    client = LocalVLMClient(settings())
    with pytest.raises(VLMError) as info:
        await collect(client, make_png(), "ui")
    assert isinstance(info.value.__cause__, RuntimeError)


# ---------------------------------------------------------------- cloud


@pytest.mark.asyncio
async def test_cloud_anthropic_request_shape() -> None:
    s = settings(anthropic_api_key="sk-a", anthropic_model="claude-x", vlm_timeout_s=9)
    client = CloudVLMClient(s)
    assert client.name == "cloud:anthropic"
    chunks = await collect(client, make_png(), "aerial")
    assert chunks == ["{", '"b": 2}']
    fake = FakeAnthropic.instances[0]
    assert fake.init["api_key"] == "sk-a"
    call = fake.calls[0]
    assert call["model"] == "claude-x"
    assert 300 <= call["max_tokens"] <= 1000
    blocks = call["messages"][0]["content"]
    img = next(b for b in blocks if b["type"] == "image")
    assert img["source"]["type"] == "base64"
    assert img["source"]["media_type"] == "image/png"
    assert any(b["type"] == "text" and "irrigation" in b["text"] for b in blocks)


@pytest.mark.asyncio
async def test_cloud_openai_request_shape() -> None:
    s = settings(cloud_provider="openai", openai_api_key="sk-o", openai_model="gpt-x")
    client = CloudVLMClient(s)
    assert client.name == "cloud:openai"
    assert await collect(client, make_png(), "ui") == ["{", '"a": 1}']
    call = FakeOpenAI.instances[0].calls[0]
    assert call["model"] == "gpt-x"
    assert call["stream"] is True


@pytest.mark.asyncio
async def test_cloud_wraps_errors_without_leaking_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    FakeOpenAI.fail = True
    client = CloudVLMClient(settings(cloud_provider="openai", openai_api_key="sk-secret"))
    with pytest.raises(VLMError) as info:
        await collect(client, make_png(), "ui")
    assert "sk-secret" not in str(info.value)
    assert "sk-secret" not in caplog.text
