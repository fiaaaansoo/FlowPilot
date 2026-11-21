"""Request body limit enforced while the body streams in.

The declared ``Content-Length`` is only a fast path: a chunked request, or one
whose header understates its size, is cut off as soon as the bytes actually
received exceed the limit, before the application parses anything. At most
``max_bytes`` are ever buffered.
"""

from __future__ import annotations

import json
from typing import Any

Scope = dict[str, Any]
Message = dict[str, Any]


class BodyLimitMiddleware:
    def __init__(self, app: Any, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") in {"GET", "HEAD", "OPTIONS", "DELETE"}:
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.max_bytes):
            await _too_large(send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return  # the client left before sending its body: nothing to answer
            body = message.get("body", b"")
            size += len(body)
            if size > self.max_bytes:
                await _too_large(send)
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()  # later calls see the real stream (e.g. http.disconnect)

        await self.app(scope, replay, send)


async def _too_large(send: Any) -> None:
    payload = json.dumps(
        {"error": "payload_too_large", "message": "The request body exceeds the configured limit."}
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": payload})
