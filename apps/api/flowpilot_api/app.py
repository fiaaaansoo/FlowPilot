"""FastAPI application: authenticated, localhost-first recovery service.

The backend has no browser privileges. It receives a bounded, sanitized
observation from the extension and returns a decision; the extension validates
and executes. Every route except ``/healthz`` requires the bearer token.
"""

from __future__ import annotations

import hmac
import threading
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .agent import RecoveryAgent
from .config import Settings
from .context_builder import fingerprint
from .contracts import (
    CONTRACT,
    Candidate,
    ElementTarget,
    ErrorBody,
    MemoryEntryOut,
    OutcomeReport,
    RecoveryRequest,
    RecoveryResponse,
)
from .prompts import PROMPT_VERSION
from .providers import ModelProvider, create_provider
from .store import Correction, Store

#: Recoveries are short and rare; more than this in parallel indicates a bug or abuse.
MAX_CONCURRENT_RECOVERIES = 2


def _error(status: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorBody(error=error, message=message).model_dump(by_alias=True))


def create_app(settings: Settings, *, provider: ModelProvider | None = None, store: Store | None = None) -> FastAPI:
    store = store or Store(settings.db_path)
    if provider is None and settings.llm_enabled:
        provider = create_provider(settings)
    agent = RecoveryAgent(settings=settings, store=store, provider=provider)
    slots = threading.BoundedSemaphore(MAX_CONCURRENT_RECOVERIES)

    app = FastAPI(title="FlowPilot recovery API", version="0.3.0", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def limit_body(request: Request, call_next):  # type: ignore[no-untyped-def]
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_request_bytes:
            return _error(413, "payload_too_large", "The request body exceeds the configured limit.")
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()))
        return _error(422, "invalid_request", f"{location}: {first.get('msg', 'invalid value')}"[:300])

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        error = exc.detail if isinstance(exc.detail, str) else "error"
        return _error(exc.status_code, error, _MESSAGES.get(error, error))

    def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = f"Bearer {settings.api_token}"
        if authorization is None or not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    auth = [Depends(authenticate)]

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/status", dependencies=auth)
    def status() -> dict[str, object]:
        return {
            "contract": CONTRACT,
            "promptVersion": PROMPT_VERSION,
            "provider": agent.provider.name if agent.provider else "none",
            "model": agent.provider.model if agent.provider else None,
            "local": agent.provider.local if agent.provider else True,
            "llmEnabled": agent.provider is not None,
        }

    @app.post("/v1/recovery/propose", dependencies=auth, response_model=RecoveryResponse, response_model_by_alias=True)
    def propose(body: RecoveryRequest) -> RecoveryResponse:
        if not slots.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="busy")
        try:
            return agent.propose(body)
        finally:
            slots.release()

    @app.post("/v1/recovery/{recovery_id}/outcome", dependencies=auth)
    def outcome(recovery_id: str, body: OutcomeReport) -> dict[str, object]:
        row = store.get_recovery(recovery_id)
        if row is None:
            raise HTTPException(status_code=404, detail="unknown_recovery")
        if row["outcome"] is not None:
            raise HTTPException(status_code=409, detail="outcome_already_reported")
        stored = False
        if body.verified and row["decision"] == "propose_target" and row["proposed_json"]:
            proposed = Candidate.model_validate_json(row["proposed_json"])
            # Only the element the backend proposed can be memorized: the client cannot inject another one.
            if body.corrected_target is not None and fingerprint(body.corrected_target) != fingerprint(proposed):
                raise HTTPException(status_code=400, detail="target_mismatch")
            original = ElementTarget.model_validate_json(row["original_json"])
            store.save_correction(
                origin=row["origin"],
                workflow_id=row["workflow_id"],
                step_id=row["step_id"],
                target_fp=fingerprint(original),
                failure_code=row["failure_code"],
                original=original,
                corrected=proposed,
                strategy=row["strategy"],
            )
            stored = True
        forgotten = 0
        if not body.verified and row["strategy"] == "memory" and row["original_json"]:
            # A memorized correction that did not work is not trusted again.
            original = ElementTarget.model_validate_json(row["original_json"])
            forgotten = store.forget_target(origin=row["origin"], target_fp=fingerprint(original))
        store.set_outcome(recovery_id, "verified" if body.verified else "failed", body.detail)
        return {"contract": CONTRACT, "memorized": stored, "forgotten": forgotten}

    @app.get("/v1/memory", dependencies=auth)
    def list_memory(origin: Annotated[str | None, Query(max_length=200)] = None) -> list[dict[str, object]]:
        return [_memory_out(c) for c in store.list_corrections(origin)]

    @app.delete("/v1/memory/{correction_id}", dependencies=auth)
    def forget(correction_id: int) -> dict[str, object]:
        if not store.forget(correction_id):
            raise HTTPException(status_code=404, detail="unknown_correction")
        return {"deleted": 1}

    @app.delete("/v1/memory", dependencies=auth)
    def clear(origin: Annotated[str | None, Query(max_length=200)] = None) -> dict[str, object]:
        return {"deleted": store.clear_corrections(origin)}

    @app.get("/v1/metrics", dependencies=auth)
    def metrics() -> dict[str, object]:
        return store.metrics()

    app.state.agent = agent
    app.state.store = store
    return app


def _memory_out(correction: Correction) -> dict[str, object]:
    return MemoryEntryOut(
        id=correction.id,
        origin=correction.origin,
        workflow_id=correction.workflow_id,
        step_id=correction.step_id,
        failure_code=correction.failure_code,
        original=correction.original,
        corrected=correction.corrected,
        strategy=correction.strategy,  # type: ignore[arg-type]
        uses=correction.uses,
        created_at=correction.created_at,
        last_used_at=correction.last_used_at,
    ).model_dump(by_alias=True, exclude_none=True)


_MESSAGES = {
    "unauthorized": "Missing or invalid bearer token.",
    "busy": "Too many recoveries in progress; retry shortly.",
    "unknown_recovery": "Unknown recovery id.",
    "outcome_already_reported": "The outcome of this recovery was already reported.",
    "target_mismatch": "The reported target is not the element that was proposed.",
    "unknown_correction": "Unknown memory entry.",
}
