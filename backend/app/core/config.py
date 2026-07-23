from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://garden:garden@localhost:5432/garden"
    cors_origins: list[str] = ["http://localhost:5173"]
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_admin_email: str = "admin@example.com"
    # Defaults to "development" so LAN-only deployments keep today's behavior
    # (interactive /docs, /redoc, /openapi.json available) unchanged. Set
    # ENVIRONMENT=production in a deployment's .env to disable them - defense
    # in depth for internet-facing setups, on top of (not instead of) keeping
    # the backend's directly-bound port un-forwarded and Basic Auth in front
    # of the reverse proxy. See #176.
    environment: Literal["development", "production"] = "development"


settings = Settings()
