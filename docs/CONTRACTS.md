# Interface Contracts (source of truth for all agents)

Every agent builds against this file. If you need to change a contract, do NOT
change it silently: say so in your PR description under "Contract changes" and
the manager decides.

## 0. Global rules

- Python 3.11+ (local dev uses 3.13, Docker uses 3.12). Type hints everywhere.
- **Tests first (TDD).** Your first commit on a branch contains only failing tests.
  Implementation comes in later commits. The manager checks the commit order.
- Comments and docstrings in English, no emojis anywhere in code or comments.
- Logging: `logger = logging.getLogger(__name__)` in every backend module. Log at
  INFO for stage boundaries (pipeline start/end with timings, VLM call start/end),
  DEBUG for internals (contour counts, merge passes), WARNING for recoverable
  issues (fallbacks, validation retries), ERROR with `exc_info` for failures.
  Never log API keys or full base64 payloads. Never call `logging.basicConfig`
  outside `app/logging_config.py`.
- No `print` in app code (CLI scripts may print their final table/summary).
- Lint clean: `ruff check` + `ruff format --check` + `mypy app` (backend),
  `npm run lint` + `npm run typecheck` (frontend).
- Line budget (core app code only, tests/infra/config excluded): **<= 1,600 total**.

| File | Budget |
|---|---|
| backend/app/cv_pipeline.py | 220 |
| backend/scripts/generate_samples.py | 160 |
| backend/app/schemas.py + config.py + vlm_client.py | 300 |
| backend/app/main.py | 200 |
| backend/app/benchmark.py | 110 |
| frontend/src (all .ts/.tsx, excluding tests) | 610 |

## 1. Dependencies (already pinned by manager)

`backend/requirements.txt` and `backend/requirements-dev.txt` are owned by the
manager. If you truly need a new package, request it in your PR description;
do not add heavyweight deps. Set up: `cd backend && uv venv && uv pip install -r requirements-dev.txt`.

## 2. `backend/app/cv_pipeline.py` (owner: agent-cv)

```python
@dataclass(frozen=True)
class BoundingBox:
    x: int; y: int; w: int; h: int
    @property
    def area(self) -> int: ...
    def to_dict(self) -> dict[str, int]: ...   # {"x","y","w","h","area"}

@dataclass(frozen=True)
class PipelineResult:
    boxes: list[BoundingBox]          # sorted by area desc, merged, filtered
    overlay_png: bytes                # target image + diff heatmap + contour/box drawing, PNG
    image_width: int
    image_height: int
    total_pixels: int
    roi_pixels: int                   # pixel count of the UNION of boxes (no double counting)
    pixels_filtered_pct: float        # 100 * (1 - roi_pixels / total_pixels), rounded 2dp
    elapsed_ms: float

class VisualDiffPipeline:
    def __init__(self, sensitivity: float = 0.5, min_area: int = 150,
                 blur_kernel: int = 5, dilate_iterations: int = 2, padding: int = 6) -> None: ...
    # sensitivity in [0, 1]; higher detects subtler changes. Validate ranges -> ValueError.
    def run(self, baseline: np.ndarray, target: np.ndarray) -> PipelineResult: ...
    # Inputs are BGR uint8. If shapes differ, target is resized to baseline size (log WARNING).
    # Steps: grayscale -> GaussianBlur -> absdiff -> adaptive threshold (combine with a
    # global floor so flat identical regions stay 0) -> morphological close + dilate ->
    # findContours -> boundingRect -> pad -> merge overlapping/adjacent -> min_area filter.

def decode_image(data: bytes) -> np.ndarray      # raises ValueError on undecodable bytes
def encode_png(image: np.ndarray) -> bytes
def crop(image: np.ndarray, box: BoundingBox) -> np.ndarray   # clamps to image bounds
def merge_boxes(boxes: list[BoundingBox], gap: int = 0) -> list[BoundingBox]  # pure, testable
```

Identical images MUST return `boxes == []`, `roi_pixels == 0`, `pixels_filtered_pct == 100.0`.

## 3. Samples (owner: agent-cv)

`backend/scripts/generate_samples.py` writes deterministic (fixed seed) PNGs:

```
backend/samples/{preset_id}_baseline.png
backend/samples/{preset_id}_target.png
backend/samples/presets.json   # [{"id","label","domain_context","expected_defects": int}]
```

| preset_id | label | domain_context | defects |
|---|---|---|---|
| pcb_board | PCB Hardware Inspection | pcb | missing SMD component, solder bridge |
| aerial_crop | Aerial Crop Monitoring | aerial | irrigation stress patch |
| ui_layout | UI Regression Check | ui | clipped button |

Size 960x640. Target must contain mild global sensor noise (the pipeline must ignore it)
plus the defects. Generated PNGs ARE committed so the app runs without running the script.

## 4. `backend/app/schemas.py`, `config.py`, `vlm_client.py` (owner: agent-vlm)

```python
class Severity(str, Enum): LOW="low"; MEDIUM="medium"; HIGH="high"; CRITICAL="critical"

class DefectReport(BaseModel):            # model_config = ConfigDict(extra="forbid")
    defect_category: str                  # 1..64 chars, snake_case-ish label e.g. "missing_component"
    severity: Severity
    confidence: float                     # 0.0..1.0
    visual_evidence: str                  # 1..500 chars
    recommended_action: str               # 1..300 chars

class BoxOut(BaseModel): id: int; x: int; y: int; w: int; h: int; area: int; est_tokens: int

class InspectResponse(BaseModel):
    preset_id: str | None
    image_width: int; image_height: int
    baseline_png_b64: str; target_png_b64: str; overlay_png_b64: str   # raw base64, no data: prefix
    boxes: list[BoxOut]
    pixels_filtered_pct: float
    full_frame_tokens: int; roi_tokens: int
    estimated_token_savings_pct: float    # 100 * (1 - roi_tokens / full_frame_tokens), 0 boxes -> 100.0
    cv_time_ms: float

class PresetOut(BaseModel): id: str; label: str; domain_context: str
```

`config.py` - `class Settings(BaseSettings)` (pydantic-settings, reads env + `.env`), `get_settings()` cached:

| Env var | Default |
|---|---|
| VLM_MODE | demo  (demo \| local \| cloud) |
| LOCAL_VLM_BASE_URL | http://localhost:8000/v1  (oMLX default; Ollama also works) |
| LOCAL_VLM_MODEL | Qwen2.5-VL-7B-Instruct-4bit |
| LOCAL_VLM_API_KEY | local  (oMLX requires a key; set real value in .env, never commit) |
| CLOUD_PROVIDER | anthropic  (anthropic \| openai) |
| ANTHROPIC_API_KEY / ANTHROPIC_MODEL | None / claude-haiku-5-5 |
| OPENAI_API_KEY / OPENAI_MODEL | None / gpt-4o-mini |
| VLM_TIMEOUT_S | 45 |
| CLOUD_DAILY_REQUEST_CAP | 200 |
| RATE_LIMIT_PER_MINUTE | 30 |
| CORS_ORIGINS | http://localhost:5173 (comma separated) |
| LOG_LEVEL / LOG_FORMAT | INFO / json  (json \| console) |
| SAMPLES_DIR | backend/samples resolved relative to package |

`vlm_client.py`:

```python
class VLMError(Exception): ...            # transport/config failure
class VLMOutputError(VLMError): ...       # model output not valid DefectReport

class VLMClient(Protocol):
    name: str                             # "demo" | "local" | "cloud:anthropic" | "cloud:openai"
    def stream_analyze(self, image_png: bytes, domain_context: str) -> AsyncIterator[str]: ...
    # yields raw text chunks; concatenated they form one JSON object

def build_prompt(domain_context: str) -> str         # instructs strict JSON matching DefectReport
def parse_report(raw: str) -> DefectReport           # tolerant JSON extraction (code fences, prose) then strict validation
def get_vlm_client(mode: str, settings: Settings) -> VLMClient   # cloud without key -> VLMError
def estimate_image_tokens(width: int, height: int) -> int        # ceil(w*h/750), min 1 (Anthropic heuristic)

DemoVLMClient   # deterministic: same image bytes + context -> same report. Uses domain_context and
                # cheap image stats (mean color, edge density, aspect) to pick a plausible defect.
                # Streams the JSON in small chunks with ~15ms delay so the UI streaming is visible.
LocalVLMClient  # openai SDK, base_url=LOCAL_VLM_BASE_URL, api_key=LOCAL_VLM_API_KEY, stream=True, image as data URL
CloudVLMClient  # anthropic SDK (messages.stream) or openai SDK, provider from settings
```

## 5. HTTP API (owner: agent-api, wave 2)

Backend listens on port **8080** (port 8000 is taken by the local oMLX server).

Base path `/api`. CORS from `CORS_ORIGINS`. Every response carries `X-Request-ID`.

- `GET /api/health` -> `{"status":"ok","vlm_mode":str,"version":str}`
- `GET /api/presets` -> `list[PresetOut]`
- `POST /api/inspect` multipart form:
  `preset_id` (str, optional) OR `baseline` + `target` (files); `sensitivity` (float 0..1, default 0.5);
  `min_area` (int, default 150). -> `InspectResponse`. 400 on bad input, 413 if file > 8 MB.
- `POST /api/analyze-roi` multipart form: `roi_image` (PNG file, cropped client side),
  `domain_context` (str: pcb | aerial | ui | free text <= 200 chars), `backend` (optional demo|local|cloud,
  default VLM_MODE). Response `text/event-stream`:

```
event: status   data: {"stage": "inference", "backend": "demo"}
event: token    data: {"text": "<raw chunk>"}            (0..n times)
event: result   data: {"report": DefectReport, "vlm_time_ms": float, "backend": str,
                       "roi_tokens": int, "cached": bool}
event: error    data: {"message": str, "code": "rate_limited|budget_exceeded|vlm_error|invalid_output"}
```

Cost guards (cloud mode only): per-IP rate limit, daily request cap, LRU cache keyed by
sha256(image bytes + context + backend). Cache applies to every backend.

## 6. Frontend (owner: agent-frontend)

Vite + React 18 + TypeScript strict. `src/types.ts` mirrors section 4/5 exactly.
`src/api.ts` uses `import.meta.env.VITE_API_BASE_URL ?? ""` as base (so the widget can be
embedded on any website pointing at a hosted backend). Dev server proxies `/api` to
`http://localhost:8080`. SSE is consumed with `fetch` + `ReadableStream` (POST, so no EventSource).
ROI crops are made client side with a canvas from `target_png_b64` and sent as PNG.

## 7. Infra (owner: agent-infra)

`backend/app/logging_config.py`: `configure_logging(level: str = "INFO", fmt: str = "json") -> None`
JSON formatter (ts, level, logger, msg, request_id if present via contextvar `request_id_var`
exported from this module, plus `extra` fields). Idempotent.

## 8. Wave 3 change: ROI pair composite (supersedes the roi_image description in section 5)

Live testing showed a VLM that only sees the target crop cannot tell what is *missing*
(it swapped "missing_component" and "solder_bridge" on the PCB sample). The VLM now gets
a single PNG with both crops side by side:

```
+-------------+---+-------------+
|  BASELINE   |gap|   TARGET    |   same box from both images, same w x h
|   crop      |8px|    crop     |   gap filled with RGB(128,128,128)
+-------------+---+-------------+   total width = 2*w + 8, height = h
```

- `roi_image` in POST /api/analyze-roi is this composite. Field names are unchanged.
- Frontend builds it client side from `baseline_png_b64` and `target_png_b64` (src/lib/crop.ts).
- Backend helper `compose_pair(baseline: np.ndarray, target: np.ndarray, box: BoundingBox) -> np.ndarray`
  lives in cv_pipeline.py and is used by benchmark.py (benchmark ROI rows use the composite).
- `build_prompt` explains the layout: left = expected baseline, right = current target; describe
  what changed from left to right.
- `roi_tokens` in the result event = `estimate_image_tokens` of the composite size.
- DemoVLMClient splits the composite at the gap and compares halves (presence of new
  bright/metallic blob, disappearance of dark component body, hue shift to yellow/brown,
  content truncated at an edge) to choose the category. Evidence text is natural language,
  no raw numeric debug stats.
