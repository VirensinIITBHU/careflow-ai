"""Provider adapters for OpenAI-compatible chat, vision, and speech inference."""
import base64
import json
import mimetypes
import re
import time
from pathlib import Path

import httpx

from . import config, llm_cache


class LLMError(RuntimeError):
    pass


def _provider(name: str) -> tuple[str, str]:
    table = {
        "groq": ("https://api.groq.com/openai/v1", config.env("GROQ_API_KEY")),
        "openrouter": ("https://openrouter.ai/api/v1", config.env("OPENROUTER_API_KEY")),
        "huggingface": ("https://router.huggingface.co/v1", config.env("HF_TOKEN")),
        "local": (config.env("LOCAL_BASE_URL", "http://localhost:11434/v1"), "local"),
    }
    base, key = table[name]
    if not key:
        secret_name = "HF_TOKEN" if name == "huggingface" else f"{name.upper()}_API_KEY"
        raise LLMError(f"{secret_name} is not set in backend/.env")
    return base, key


def _post(url: str, key: str, timeout: float, **kw) -> dict:
    last = None
    for attempt in range(3):  # retry transient failures (429 / 5xx / network) with backoff
        try:
            r = httpx.post(url, headers={"Authorization": f"Bearer {key}"}, timeout=timeout, **kw)
            if r.status_code < 400:
                return r.json()
            last = LLMError(f"HTTP {r.status_code}: {r.text[:300]}")
            if r.status_code < 500 and r.status_code != 429:
                break  # a 4xx other than 429 will not get better by retrying
            wait = 2.0 * (attempt + 1)
            try:
                wait = min(float(r.headers.get("retry-after", wait)), 15.0)
            except ValueError:
                pass
        except httpx.HTTPError as e:
            last = LLMError(f"{type(e).__name__}: {e}")
            wait = 2.0 * (attempt + 1)
        if attempt < 2:
            time.sleep(wait)
    raise last or LLMError("request failed")


def _loads(text: str) -> dict:
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise LLMError("Model did not return JSON")


def _chat_body(provider: str, model: str, system: str, user, max_tokens: int, json_mode: bool) -> dict:
    body = {"model": model, "temperature": 0, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if "gpt-oss" in model and provider == "groq":
        body["reasoning_effort"] = "low"  # reasoning models spend tokens thinking before the JSON
    if model == "qwen/qwen3.8-27b" and provider == "groq":
        body["reasoning_effort"] = "low"
    if provider == "openrouter":
        body["reasoning"] = {"effort": "low"}  # OpenRouter-normalized; models without reasoning ignore it
    return body


def chat_json(provider: str, model: str, system: str, user, max_tokens: int = 3000, timeout: float = 60) -> dict:
    k = llm_cache.key("chat", provider, model, system, user, max_tokens)
    return llm_cache.through(k, lambda: _chat_json_live(provider, model, system, user, max_tokens, timeout))


def _chat_json_live(provider: str, model: str, system: str, user, max_tokens: int, timeout: float) -> dict:
    base, key = _provider(provider)
    try:
        data = _post(f"{base}/chat/completions", key, timeout,
                     json=_chat_body(provider, model, system, user, max_tokens, True))
    except LLMError as e:
        # Some models/providers reject strict JSON mode (e.g. Groq "json_validate_failed" when a reasoning
        # model adds text around the JSON). Our prompts already demand JSON and _loads() can extract it.
        msg = str(e).lower()
        if not any(t in msg for t in ("json_validate_failed", "response_format", "json mode", "json_object")):
            raise
        data = _post(f"{base}/chat/completions", key, timeout,
                     json=_chat_body(provider, model, system, user, max_tokens, False))
    choice = (data.get("choices") or [{}])[0]
    content = choice.get("message", {}).get("content")
    if choice.get("finish_reason") == "length":
        raise LLMError("Model output was cut off (finish_reason=length): reasoning used the token budget; raise max_tokens or use a non-reasoning model")
    if not content:
        raise LLMError("Empty model response")
    return _loads(content)


def transcribe(path: Path, model: str, language: str | None) -> dict:
    """Transcribe through a configured provider, normalizing output for the pipeline."""
    k = llm_cache.key("stt", config.STT_PROVIDER, model, language, path.read_bytes())
    return llm_cache.through(k, lambda: _transcribe_live(path, model, language))


def _transcribe_live(path: Path, model: str, language: str | None) -> dict:
    if config.STT_PROVIDER == "huggingface":
        _, key = _provider("huggingface")
        raw = base64.b64encode(path.read_bytes()).decode("ascii")
        data = _post(
            f"https://router.huggingface.co/hf-inference/models/{model}", key, 120,
            json={"inputs": raw, "parameters": {"return_timestamps": True}},
        )
        segments = []
        for chunk in data.get("chunks") or []:
            start, end = chunk.get("timestamp") or (None, None)
            if start is None or end is None:
                continue
            segments.append({"text": chunk.get("text", ""), "start": start, "end": end,
                             "confidence_unavailable": True})
        return {"text": data.get("text", ""), "segments": segments,
                "language": None, "language_hint_ignored": bool(language),
                "confidence_unavailable": True}

    base, key = _provider(config.STT_PROVIDER)
    form = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    if language:
        form["language"] = language
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    payload = path.read_bytes()  # bytes (not a file handle) so the retry in _post can resend the upload
    return _post(f"{base}/audio/transcriptions", key, 120, data=form, files={"file": (path.name, payload, mime)})


def _shrink_image(path: Path, max_side: int = 1500) -> tuple[str, bytes]:
    """Downscale big images and re-encode as JPEG so the upload stays small (large base64 bodies
    caused WriteTimeout on slow links). Falls back to the original bytes if Pillow can't read it."""
    try:
        import io
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return "image/jpeg", buf.getvalue()
    except Exception:
        return mimetypes.guess_type(path.name)[0] or "image/png", path.read_bytes()


_VERDICT = re.compile(r"(user|response)\s*safety|safety\s*categor|^\s*(safe|unsafe)\s*$", re.I | re.M)


def vision_json(prompt: str, path: Path, model: str | None = None) -> dict:
    """Send an image + prompt to the configured vision provider. Returns {"text", "illegible_regions", "notes"}.
    Uses a plain chat call (no JSON mode, no reasoning flags): free OpenRouter vision endpoints often reject them.
    Raises LLMError if the model answered with a safety verdict instead of a transcription."""
    provider, name = config.VISION_PROVIDER, model or config.VISION_MODEL
    k = llm_cache.key("vision", provider, name, prompt, path.read_bytes())
    return llm_cache.through(k, lambda: _vision_live(prompt, path, provider, name))


def _vision_live(prompt: str, path: Path, provider: str, name: str) -> dict:
    mime, raw = _shrink_image(path)
    uri = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    content = [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": uri}}]
    base, key = _provider(provider)
    body = {"model": name, "temperature": 0, "max_tokens": 8000,
            "messages": [{"role": "system", "content": "You transcribe documents. Return only JSON."},
                         {"role": "user", "content": content}]}
    data = _post(f"{base}/chat/completions", key, 120, json=body)
    choice = (data.get("choices") or [{}])[0]
    text = choice.get("message", {}).get("content")
    if isinstance(text, list):  # some providers return content parts
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    if not text or not text.strip():
        raise LLMError("Empty vision model response")
    try:
        out = _loads(text)
    except Exception:
        out = None
    if isinstance(out, dict) and isinstance(out.get("text"), str):
        return out
    if out is None and len(text) < 400 and _VERDICT.search(text):
        raise LLMError(f"{name} returned a safety verdict, not a transcription")
    if out is not None:  # JSON without a "text" field (e.g. a classifier's {"User Safety": "safe"})
        raise LLMError(f"{name} returned JSON without a transcription")
    # Plain prose: the model transcribed but ignored the JSON wrapper.
    return {"text": text.strip(), "illegible_regions": 0, "notes": ""}
