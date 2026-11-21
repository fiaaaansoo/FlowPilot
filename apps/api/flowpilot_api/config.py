"""Environment-based configuration. No secret is ever read from the repository.

A local ``apps/api/.env`` file (git-ignored) may set the same variables; real
environment variables take precedence. See ``.env.example`` for every option.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .pricing import DEFAULT_CLAUDE_MODEL, price_for

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

PROVIDERS = ("none", "ollama", "openai-compatible", "anthropic", "mock")


class ConfigError(Exception):
    pass


def load_dotenv(path: Path) -> None:
    """Minimal ``KEY=VALUE`` loader (no interpolation). Existing variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    try:
        return int(value) if value else default
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc


def _float(name: str, default: float) -> float:
    value = os.environ.get(name)
    try:
        return float(value) if value else default
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number") from exc


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    api_token: str
    host: str = "127.0.0.1"
    port: int = 8787
    allow_remote: bool = False
    allowed_origins: tuple[str, ...] = ()
    provider: str = "none"
    model: str | None = None
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_num_ctx: int = 4096
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    openai_is_local: bool = True
    anthropic_effort: str = "medium"
    llm_timeout_s: float = 30.0
    llm_max_retries: int = 1
    context_max_elements: int = 12
    context_max_chars: int = 6_000
    db_path: Path = field(default_factory=lambda: Path(".data/flowpilot.sqlite3"))
    mock_rules: dict[str, str] = field(default_factory=dict)
    #: Prices in USD per million tokens for providers that bill per token (overrides the built-in table).
    price_input: float | None = None
    price_output: float | None = None
    max_request_bytes: int = 512_000

    @property
    def llm_enabled(self) -> bool:
        return self.provider != "none"


def load_settings(env_file: Path | None = None) -> Settings:
    if env_file is not None:
        load_dotenv(env_file)
    token = os.environ.get("FLOWPILOT_API_TOKEN", "")
    if len(token) < 24:
        raise ConfigError(
            "FLOWPILOT_API_TOKEN must be set to a random secret of at least 24 characters "
            "(generate one with `python -m flowpilot_api token`)."
        )
    provider = os.environ.get("FLOWPILOT_PROVIDER", "none").strip().lower()
    if provider not in PROVIDERS:
        raise ConfigError(f"FLOWPILOT_PROVIDER must be one of {', '.join(PROVIDERS)}")
    host = os.environ.get("FLOWPILOT_HOST", "127.0.0.1")
    allow_remote = _flag("FLOWPILOT_ALLOW_REMOTE")
    if host not in LOOPBACK_HOSTS and not allow_remote:
        raise ConfigError("Refusing to listen on a non-loopback address without FLOWPILOT_ALLOW_REMOTE=1.")

    rules: dict[str, str] = {}
    for pair in filter(None, os.environ.get("FLOWPILOT_MOCK_RULES", "").split(";")):
        if "=>" in pair:
            recorded, proposed = pair.split("=>", 1)
            rules[recorded.strip()] = proposed.strip()

    price_in = os.environ.get("FLOWPILOT_PRICE_INPUT_PER_MTOK")
    price_out = os.environ.get("FLOWPILOT_PRICE_OUTPUT_PER_MTOK")
    model = os.environ.get("FLOWPILOT_MODEL") or None
    openai_base_url = os.environ.get("FLOWPILOT_OPENAI_BASE_URL") or None
    openai_is_local = _openai_is_local(openai_base_url)
    _require_price(provider, model, openai_is_local, price_in, price_out)
    return Settings(
        api_token=token,
        host=host,
        port=_int("FLOWPILOT_PORT", 8787),
        allow_remote=allow_remote,
        allowed_origins=tuple(
            o.strip() for o in os.environ.get("FLOWPILOT_ALLOWED_ORIGINS", "").split(",") if o.strip()
        ),
        provider=provider,
        model=model,
        ollama_url=os.environ.get("FLOWPILOT_OLLAMA_URL", "http://127.0.0.1:11434"),
        ollama_num_ctx=_int("FLOWPILOT_OLLAMA_NUM_CTX", 4096),
        openai_base_url=openai_base_url,
        openai_api_key=os.environ.get("FLOWPILOT_OPENAI_API_KEY") or None,
        openai_is_local=openai_is_local,
        anthropic_effort=os.environ.get("FLOWPILOT_ANTHROPIC_EFFORT", "medium"),
        llm_timeout_s=_float("FLOWPILOT_LLM_TIMEOUT_S", 30.0),
        llm_max_retries=_int("FLOWPILOT_LLM_MAX_RETRIES", 1),
        context_max_elements=_int("FLOWPILOT_CONTEXT_MAX_ELEMENTS", 12),
        context_max_chars=_int("FLOWPILOT_CONTEXT_MAX_CHARS", 6_000),
        db_path=Path(os.environ.get("FLOWPILOT_DB_PATH", ".data/flowpilot.sqlite3")),
        mock_rules=rules,
        price_input=float(price_in) if price_in else None,
        price_output=float(price_out) if price_out else None,
    )


def _openai_is_local(base_url: str | None) -> bool:
    """A loopback server is local (no API charge); any other endpoint is treated as paid unless declared local."""
    if _flag("FLOWPILOT_OPENAI_IS_PAID"):
        return False
    if _flag("FLOWPILOT_OPENAI_IS_LOCAL"):
        return True
    host = (urlsplit(base_url).hostname or "") if base_url else ""
    return host in LOOPBACK_HOSTS


def _require_price(provider: str, model: str | None, local: bool, price_in: str | None, price_out: str | None) -> None:
    """Refuse to start a paid provider whose cost cannot be estimated: the cost budget would not apply."""
    paid = provider == "anthropic" or (provider == "openai-compatible" and not local)
    if provider == "anthropic":
        model = model or DEFAULT_CLAUDE_MODEL
    if not paid or (price_in and price_out) or price_for(model) is not None:
        return
    raise ConfigError(
        f"No price is known for model {model or '(default)'} of provider {provider}: set "
        "FLOWPILOT_PRICE_INPUT_PER_MTOK and FLOWPILOT_PRICE_OUTPUT_PER_MTOK so the cost budget can be enforced."
    )
