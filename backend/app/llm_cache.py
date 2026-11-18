"""Record/replay cache for provider responses, so a demo can run when providers are slow or rate-limited.

Modes (LLM_CACHE): off | record (always call live, store result) | replay (cache only; miss raises) |
auto (cache hit if present, else live + record). Keys are SHA-256 digests of the full request, so a cached
answer is only ever returned for exactly the same model, prompt and input bytes.
The cache stores model outputs that may contain synthetic patient text; never use it with real data."""
import hashlib
import json
import threading

from . import config

_lock = threading.Lock()
_mem: dict[str, dict] | None = None
_loaded_from = None


class CacheMiss(RuntimeError):
    pass


def key(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else json.dumps(p, sort_keys=True, ensure_ascii=False).encode())
        h.update(b"\x1f")
    return h.hexdigest()


def _load() -> dict[str, dict]:
    global _mem, _loaded_from
    path = config.LLM_CACHE_PATH
    if _mem is None or _loaded_from != path:
        _mem, _loaded_from = {}, path
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    row = json.loads(line)
                    _mem[row["k"]] = row["v"]
                except (ValueError, KeyError):
                    continue
    return _mem


def through(k: str, live):
    """Return the cached value for key k or compute it with live(), depending on the cache mode."""
    mode = config.LLM_CACHE
    if mode not in ("record", "replay", "auto"):
        return live()
    with _lock:
        mem = _load()
        if mode in ("replay", "auto") and k in mem:
            return mem[k]
    if mode == "replay":
        raise CacheMiss("LLM_CACHE=replay and this request is not cached")
    value = live()
    with _lock:
        mem = _load()
        mem[k] = value
        config.LLM_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with config.LLM_CACHE_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"k": k, "v": value}, ensure_ascii=False) + "\n")
    return value


def stats() -> dict:
    with _lock:
        return {"mode": config.LLM_CACHE, "entries": len(_load()) if config.LLM_CACHE != "off" else 0}
