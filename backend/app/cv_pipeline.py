"""Deterministic OpenCV visual-diff pipeline (stage 1 of the two-stage funnel).

Returns padded, merged boxes around changed regions, a heatmap overlay and
pixel-savings statistics. Only these regions are later sent to a VLM.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Sensitivity 0 -> strict intensity floor, 1 -> permissive floor.
_FLOOR_STRICT, _FLOOR_LOOSE = 40.0, 6.0
# Adaptive threshold: how far a pixel must rise above its local mean.
_C_STRICT, _C_LOOSE = 8, 2
_ADAPTIVE_BLOCK = 101
_HEATMAP_ALPHA = 0.55
# Width and gray level of the separator between the two halves of a ROI pair.
PAIR_GAP, PAIR_GAP_COLOR = 8, 128


@dataclass(frozen=True)
class BoundingBox:
    """Axis-aligned box in pixel coordinates (top-left origin)."""

    x: int
    y: int
    w: int
    h: int

    @property
    def area(self) -> int:
        """Box area in pixels."""
        return self.w * self.h

    def to_dict(self) -> dict[str, int]:
        """Serialise as {"x","y","w","h","area"}."""
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h, "area": self.area}


@dataclass(frozen=True)
class PipelineResult:
    """Outcome of one pipeline run."""

    boxes: list[BoundingBox]
    overlay_png: bytes
    image_width: int
    image_height: int
    total_pixels: int
    roi_pixels: int
    pixels_filtered_pct: float
    elapsed_ms: float


def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes into a BGR uint8 array; raise ValueError if undecodable."""
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR) if data else None
    if image is None:
        raise ValueError("Could not decode image bytes")
    return image


def encode_png(image: np.ndarray) -> bytes:
    """Encode a BGR image as PNG bytes."""
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG encoding failed")
    return bytes(buf.tobytes())


def crop(image: np.ndarray, box: BoundingBox) -> np.ndarray:
    """Return the sub-image under ``box``, clamped to the image bounds."""
    h, w = image.shape[:2]
    x0, y0 = max(0, box.x), max(0, box.y)
    return image[y0 : max(y0, min(h, box.y + box.h)), x0 : max(x0, min(w, box.x + box.w))].copy()


def compose_pair(baseline: np.ndarray, target: np.ndarray, box: BoundingBox) -> np.ndarray:
    """Place the baseline and target crops of ``box`` side by side, separated by a gray gap."""
    left, right = crop(baseline, box), crop(target, box)
    gap = np.full((left.shape[0], PAIR_GAP, 3), PAIR_GAP_COLOR, dtype=np.uint8)
    return np.hstack([left, gap, right])


def _union(a: BoundingBox, b: BoundingBox) -> BoundingBox:
    x0, y0 = min(a.x, b.x), min(a.y, b.y)
    return BoundingBox(x0, y0, max(a.x + a.w, b.x + b.w) - x0, max(a.y + a.h, b.y + b.h) - y0)


def _touches(a: BoundingBox, b: BoundingBox, gap: int) -> bool:
    """True if the boxes overlap or are separated by at most ``gap`` pixels."""
    dx = max(a.x, b.x) - min(a.x + a.w, b.x + b.w)
    dy = max(a.y, b.y) - min(a.y + a.h, b.y + b.h)
    return dx <= gap and dy <= gap


def merge_boxes(boxes: list[BoundingBox], gap: int = 0) -> list[BoundingBox]:
    """Merge overlapping or adjacent boxes until the set is stable (pure function)."""
    pending = list(boxes)
    while True:
        merged: list[BoundingBox] = []
        for box in pending:
            hit = next((i for i, o in enumerate(merged) if _touches(box, o, gap)), None)
            if hit is None:
                merged.append(box)
            else:
                merged[hit] = _union(box, merged[hit])
        if len(merged) == len(pending):
            logger.debug("merge_boxes stable: %d -> %d boxes", len(boxes), len(merged))
            return merged
        pending = merged


class VisualDiffPipeline:
    """Noise-robust image differencing that yields merged regions of interest."""

    def __init__(
        self,
        sensitivity: float = 0.5,
        min_area: int = 150,
        blur_kernel: int = 5,
        dilate_iterations: int = 2,
        padding: int = 6,
    ) -> None:
        """Configure the pipeline; raises ValueError on out-of-range parameters."""
        if not 0.0 <= sensitivity <= 1.0:
            raise ValueError("sensitivity must be within [0, 1]")
        if min(min_area, dilate_iterations, padding) < 0 or blur_kernel < 1:
            raise ValueError("min_area/dilate_iterations/padding must be >= 0, blur_kernel >= 1")
        self.sensitivity = sensitivity
        self.min_area = min_area
        self.blur_kernel = blur_kernel | 1  # Gaussian kernels must be odd
        self.dilate_iterations = dilate_iterations
        self.padding = padding

    def _diff(self, baseline: np.ndarray, target: np.ndarray) -> np.ndarray:
        """Blurred absolute difference: max over luminance and colour channels."""
        k = (self.blur_kernel, self.blur_kernel)
        a, b = cv2.GaussianBlur(baseline, k, 0), cv2.GaussianBlur(target, k, 0)
        gray = cv2.absdiff(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b, cv2.COLOR_BGR2GRAY))
        return np.maximum(gray, cv2.absdiff(a, b).max(axis=2))

    def _mask(self, diff: np.ndarray) -> np.ndarray:
        """Binary change mask: global intensity floor AND local adaptive threshold."""
        s = self.sensitivity
        floor = _FLOOR_STRICT + (_FLOOR_LOOSE - _FLOOR_STRICT) * s
        c = round(_C_STRICT + (_C_LOOSE - _C_STRICT) * s)
        _, strong = cv2.threshold(diff, floor - 1, 255, cv2.THRESH_BINARY)
        local = cv2.adaptiveThreshold(
            diff, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, _ADAPTIVE_BLOCK, -c
        )
        # Large uniform changes have a flat interior the local test rejects; any pixel
        # far above the floor is kept so interiors stay connected.
        _, very_strong = cv2.threshold(diff, floor * 2, 255, cv2.THRESH_BINARY)
        mask = cv2.bitwise_and(strong, cv2.bitwise_or(local, very_strong))
        ellipse = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        return np.asarray(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, ellipse))

    def _boxes(self, mask: np.ndarray) -> list[BoundingBox]:
        """Contours -> tight boxes -> pad -> merge -> min-area filter."""
        height, width = mask.shape
        # Dilation only groups nearby fragments; boxes are tightened on the undilated mask.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        grouped = cv2.dilate(mask, kernel, iterations=self.dilate_iterations)
        contours, _ = cv2.findContours(grouped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        raw: list[BoundingBox] = []
        for cnt in contours:
            gx, gy, gw, gh = cv2.boundingRect(cnt)
            pts = cv2.findNonZero(mask[gy : gy + gh, gx : gx + gw])
            if pts is None:
                continue
            tx, ty, w, h = cv2.boundingRect(pts)
            if w * h < self.min_area:
                continue
            x0, y0 = max(0, gx + tx - self.padding), max(0, gy + ty - self.padding)
            x1, y1 = min(width, gx + tx + w + self.padding), min(height, gy + ty + h + self.padding)
            raw.append(BoundingBox(x0, y0, x1 - x0, y1 - y0))
        logger.debug("contours=%d kept=%d", len(contours), len(raw))
        merged = [b for b in merge_boxes(raw) if b.area >= self.min_area]
        return sorted(merged, key=lambda b: b.area, reverse=True)

    @staticmethod
    def _overlay(
        target: np.ndarray, diff: np.ndarray, mask: np.ndarray, boxes: list[BoundingBox]
    ) -> np.ndarray:
        """Target with a colormap heatmap blended only where the change mask is set."""
        norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
        heat = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
        blended = cv2.addWeighted(target, 1 - _HEATMAP_ALPHA, heat, _HEATMAP_ALPHA, 0)
        out = np.where(mask[..., None] > 0, blended, target).astype(np.uint8)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, contours, -1, (255, 255, 255), 1)
        font = cv2.FONT_HERSHEY_SIMPLEX
        for i, b in enumerate(boxes, start=1):
            cv2.rectangle(out, (b.x, b.y), (b.x + b.w, b.y + b.h), (0, 255, 255), 2)
            cv2.putText(out, str(i), (b.x + 3, max(14, b.y - 5)), font, 0.5, (0, 255, 255), 1)
        return out

    def run(self, baseline: np.ndarray, target: np.ndarray) -> PipelineResult:
        """Diff two BGR uint8 images and return boxes, overlay and pixel statistics."""
        t0 = time.perf_counter()
        height, width = baseline.shape[:2]
        if target.shape[:2] != (height, width):
            logger.warning("Size mismatch %s vs %s; resizing target", baseline.shape, target.shape)
            target = cv2.resize(target, (width, height), interpolation=cv2.INTER_AREA)
        diff = self._diff(baseline, target)
        mask = self._mask(diff)
        boxes = self._boxes(mask)

        union = np.zeros((height, width), dtype=np.uint8)  # mask avoids double counting overlaps
        for b in boxes:
            union[b.y : b.y + b.h, b.x : b.x + b.w] = 1
        roi_pixels, total = int(cv2.countNonZero(union)), width * height
        pct = round(100.0 * (1 - roi_pixels / total), 2)

        overlay = encode_png(self._overlay(target, diff, mask, boxes))
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info("cv done: boxes=%d filtered=%.2f%% ms=%.1f", len(boxes), pct, elapsed)
        return PipelineResult(boxes, overlay, width, height, total, roi_pixels, pct, elapsed)
