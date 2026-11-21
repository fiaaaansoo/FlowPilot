"""Command line: ``python -m flowpilot_api serve`` or ``python -m flowpilot_api token``."""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

from .config import ConfigError, load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="flowpilot-api", description="FlowPilot local recovery backend")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="run the API (reads .env in the current directory)")
    serve.add_argument("--env-file", type=Path, default=Path(".env"))
    sub.add_parser("token", help="print a new random API token")
    args = parser.parse_args(argv)

    if args.command == "token":
        print(secrets.token_urlsafe(32))
        return 0

    try:
        settings = load_settings(args.env_file)
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    import uvicorn

    from .app import create_app

    provider = settings.provider if settings.llm_enabled else "none (deterministic and semantic recovery only)"
    print(f"FlowPilot API on http://{settings.host}:{settings.port} - provider: {provider}", file=sys.stderr)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
