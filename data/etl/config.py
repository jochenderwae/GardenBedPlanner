from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DATA_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = DATA_DIR.parent

CACHE_DIR = DATA_DIR / ".cache"
STATE_DB = DATA_DIR / ".state" / "progress.db"
PLANTS_OUT_DIR = DATA_DIR / "plants"
PLANT_SCHEMA_PATH = DATA_DIR / "plant.schema.json"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"), extra="ignore"
    )

    permapeople_key_id: str | None = None
    permapeople_key_secret: str | None = None
    trefle_token: str | None = None

    # Explicit alias: Ollama's own server process reads a system-wide
    # OLLAMA_HOST env var (commonly just "0.0.0.0" or "127.0.0.1", no
    # scheme, since that's a bind address not a URL) - pydantic-settings
    # would otherwise silently pick that up instead of our default here,
    # which is a URL. Bit us for real on first run (httpx rejected the
    # resulting scheme-less URL); ETL_OLLAMA_HOST avoids the collision.
    ollama_host: str = Field(default="http://localhost:11434", alias="ETL_OLLAMA_HOST")
    ollama_model: str = "mistral-small:latest"

    # Conservative default; per-source overrides live in each source module
    # (e.g. Trefle's documented 120/min -> 0.5s) rather than here.
    default_min_interval_seconds: float = 1.5

    @field_validator("ollama_host")
    @classmethod
    def _ensure_scheme(cls, v: str) -> str:
        # Belt-and-suspenders on top of the ETL_OLLAMA_HOST alias above: if
        # something still hands us a bare host:port (or just a host), don't
        # let httpx fail obscurely later - fix it up front.
        return v if "://" in v else f"http://{v}"


settings = Settings()

for d in (CACHE_DIR, STATE_DB.parent, PLANTS_OUT_DIR):
    d.mkdir(parents=True, exist_ok=True)
