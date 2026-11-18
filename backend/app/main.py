"""FastAPI application: health, presets, CV inspection and streamed VLM diagnosis."""

import base64
import hashlib
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

import cv2
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.cv_pipeline import VisualDiffPipeline, decode_image, encode_png
from app.guards import DailyBudget, RateLimiter, ResponseCache
from app.logging_config import configure_logging, request_id_var
from app.schemas import BoxOut, InspectResponse, PresetOut
from app.vlm_client import VLMError, VLMOutputError, get_vlm_client, parse_report
from app.vlm_client import estimate_image_tokens as est_tokens

logger = logging.getLogger(__name__)

VERSION = "0.1.0"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_CONTEXT_CHARS = 200
settings = get_settings()


cache = ResponseCache(256)
limiter = RateLimiter()
budget = DailyBudget()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Configure logging and load the preset catalogue once at startup."""
    configure_logging(settings.log_level, settings.log_format)
    app.state.presets = json.loads((settings.samples_dir / "presets.json").read_text("utf-8"))
    logger.info("started version=%s vlm_mode=%s", VERSION, settings.vlm_mode)
    yield


app = FastAPI(title="Visual QA X-Ray Lens", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Attach a request id, log one access line and echo the id in the response."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = request_id_var.set(rid)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        ms = round((time.perf_counter() - started) * 1000, 1)
        logger.error("%s %s 500 %.1fms", request.method, request.url.path, ms, exc_info=True)
        raise
    ms = round((time.perf_counter() - started) * 1000, 1)
    extra = {"status": response.status_code, "elapsed_ms": ms}
    logger.info(
        "%s %s %d %.1fms", request.method, request.url.path, extra["status"], ms, extra=extra
    )
    response.headers["X-Request-ID"] = rid
    request_id_var.reset(token)
    return response


@app.exception_handler(RequestValidationError)
async def bad_request(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Report malformed form parameters as 400 rather than FastAPI's default 422."""
    return JSONResponse({"detail": "Invalid request parameters"}, status_code=400)


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Report liveness, the default VLM mode and the API version."""
    return {"status": "ok", "vlm_mode": settings.vlm_mode, "version": VERSION}


@app.get("/api/presets", response_model=list[PresetOut])
async def presets() -> list[PresetOut]:
    """List the bundled sample presets."""
    return [PresetOut.model_validate(p) for p in app.state.presets]


async def _read_upload(upload: UploadFile) -> bytes:
    """Read an upload, rejecting anything over the size limit with 413."""
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 8 MB limit")
    return data


def _b64_png(image: Any) -> str:
    return base64.b64encode(encode_png(image)).decode()


def _inspect(preset_id: str | None, base: bytes, tgt: bytes, sens: float, area: int) -> Any:
    """CPU-bound part of /inspect (runs in a worker thread); returns an InspectResponse."""
    baseline, target = decode_image(base), decode_image(tgt)
    if target.shape[:2] != baseline.shape[:2]:
        target = cv2.resize(target, (baseline.shape[1], baseline.shape[0]))
    res = VisualDiffPipeline(sensitivity=sens, min_area=area).run(baseline, target)
    boxes = [
        BoxOut(id=i, **b.to_dict(), est_tokens=est_tokens(b.w, b.h))
        for i, b in enumerate(res.boxes, start=1)
    ]
    full = est_tokens(res.image_width, res.image_height)
    roi = sum(b.est_tokens for b in boxes)
    return InspectResponse(
        preset_id=preset_id,
        image_width=res.image_width,
        image_height=res.image_height,
        baseline_png_b64=_b64_png(baseline),
        target_png_b64=_b64_png(target),
        overlay_png_b64=base64.b64encode(res.overlay_png).decode(),
        boxes=boxes,
        pixels_filtered_pct=res.pixels_filtered_pct,
        full_frame_tokens=full,
        roi_tokens=roi,
        estimated_token_savings_pct=round(100.0 * (1 - roi / full), 2) if boxes else 100.0,
        cv_time_ms=round(res.elapsed_ms, 2),
    )


@app.post("/api/inspect", response_model=InspectResponse)
async def inspect(
    preset_id: Annotated[str | None, Form()] = None,
    baseline: Annotated[UploadFile | None, File()] = None,
    target: Annotated[UploadFile | None, File()] = None,
    sensitivity: Annotated[float, Form(ge=0.0, le=1.0)] = 0.5,
    min_area: Annotated[int, Form(ge=0)] = 150,
) -> Any:
    """Run the CV pipeline on a preset or on two uploaded images."""
    if preset_id:
        if preset_id not in {p["id"] for p in app.state.presets}:
            raise HTTPException(400, "Unknown preset")
        base = (settings.samples_dir / f"{preset_id}_baseline.png").read_bytes()
        tgt = (settings.samples_dir / f"{preset_id}_target.png").read_bytes()
    elif baseline is not None and target is not None:
        base, tgt = await _read_upload(baseline), await _read_upload(target)
    else:
        raise HTTPException(400, "Provide preset_id or both baseline and target files")
    try:
        out = await run_in_threadpool(_inspect, preset_id or None, base, tgt, sensitivity, min_area)
    except ValueError as exc:
        raise HTTPException(400, "Could not process the images") from exc
    logger.info("inspect preset=%s boxes=%d", preset_id, len(out.boxes))
    return out


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _analysis_events(
    image: bytes, context: str, mode: str, ip: str, tokens: int
) -> AsyncIterator[str]:
    """Yield the SSE frames for one ROI diagnosis, applying cache and cost guards."""
    key = hashlib.sha256(image + b"\0" + context.encode() + b"\0" + mode.encode()).hexdigest()
    hit = cache.lookup(key)
    if hit is not None:
        logger.info("analyze cache hit backend=%s", mode)
        yield _sse("status", {"stage": "inference", "backend": hit["backend"]})
        yield _sse("result", {**hit, "roi_tokens": tokens, "cached": True})
        return
    if mode == "cloud":
        denied = None
        if not limiter.allow(ip, settings.rate_limit_per_minute):
            denied = ("rate_limited", "Too many requests, slow down.")
        elif not budget.take(settings.cloud_daily_request_cap):
            denied = ("budget_exceeded", "Daily cloud budget used up. Try demo mode.")
        if denied:
            logger.warning("cloud analyze denied code=%s ip=%s", denied[0], ip)
            yield _sse("error", {"message": denied[1], "code": denied[0]})
            return
    code, message = "vlm_error", "The VLM backend is unavailable."
    try:
        client = get_vlm_client(mode, settings)
        yield _sse("status", {"stage": "inference", "backend": client.name})
        started, chunks = time.perf_counter(), []
        async for chunk in client.stream_analyze(image, context):
            chunks.append(chunk)
            yield _sse("token", {"text": chunk})
        report = parse_report("".join(chunks))
    except VLMOutputError:
        code, message = "invalid_output", "The model returned an invalid report."
    except VLMError as exc:
        logger.error("VLM failure: %s", type(exc).__name__)
    except Exception:
        logger.error("unexpected analyze failure", exc_info=True)
    else:
        ms = round((time.perf_counter() - started) * 1000, 1)
        result = {"report": report.model_dump(mode="json"), "vlm_time_ms": ms}
        result["backend"] = client.name
        cache.store(key, result)
        yield _sse("result", {**result, "roi_tokens": tokens, "cached": False})
        return
    yield _sse("error", {"message": message, "code": code})


@app.post("/api/analyze-roi")
async def analyze_roi(
    request: Request,
    roi_image: Annotated[UploadFile, File()],
    domain_context: Annotated[str, Form()] = "",
    backend: Annotated[str | None, Form()] = None,
) -> StreamingResponse:
    """Stream a structured VLM diagnosis of one cropped region as Server-Sent Events."""
    mode = backend or settings.vlm_mode
    if mode not in ("demo", "local", "cloud") or len(domain_context) > MAX_CONTEXT_CHARS:
        raise HTTPException(400, "Invalid backend or domain_context")
    image = await _read_upload(roi_image)
    try:
        height, width = decode_image(image).shape[:2]
    except ValueError as exc:
        raise HTTPException(400, "roi_image is not a decodable image") from exc
    ip = request.client.host if request.client else "unknown"
    events = _analysis_events(image, domain_context, mode, ip, est_tokens(width, height))
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
