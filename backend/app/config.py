"""Application settings, read from environment variables and an optional .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEFAULT_SAMPLES_DIR = Path(__file__).resolve().parent.parent / "samples"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vlm_mode: Literal["demo", "local", "cloud"] = "demo"
    local_vlm_base_url: str = "http://localhost:8000/v1"
    local_vlm_model: str = "Qwen2.5-VL-7B-Instruct-4bit"
    local_vlm_api_key: SecretStr = SecretStr("local")
    cloud_provider: Literal["anthropic", "openai"] = "anthropic"
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-haiku-5-5"
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-4o-mini"
    vlm_timeout_s: float = 45
    cloud_daily_request_cap: int = 200
    rate_limit_per_minute: int = 30
    # NoDecode: accept a plain comma separated string instead of JSON.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"
    samples_dir: Path = DEFAULT_SAMPLES_DIR

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
