from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://garden:garden@localhost:5432/garden"
    cors_origins: list[str] = ["http://localhost:5173"]
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_admin_email: str = "admin@example.com"


settings = Settings()
