"""All settings come from environment variables (backend/.env). Modules read config.X at call time."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parents[1]
load_dotenv(BASE / ".env")


def env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


DB_PATH = env("CAREFLOW_DB_PATH", str(BASE / "data" / "careflow.db"))
UPLOAD_DIR = Path(env("CAREFLOW_UPLOAD_DIR", str(BASE / "data" / "uploads")))
POLICY_PATH = BASE / "policy" / "general_v0.yaml"

# Defaults: gpt-oss-20b (Groq) for extraction/translation/second reader, Whisper large v3 (Groq) for audio,
# Nemotron on OpenRouter for report images. Override in backend/.env.
EXTRACT_PROVIDER = env("EXTRACT_PROVIDER", "groq")
EXTRACT_MODEL = env("EXTRACT_MODEL", "openai/gpt-oss-20b")
EXTRACT_FALLBACK_MODEL = env("EXTRACT_FALLBACK_MODEL", "openai/gpt-oss-20b")
STT_PROVIDER = env("STT_PROVIDER", "groq")
STT_MODEL = env("STT_MODEL", "whisper-large-v3")
VISION_PROVIDER = env("VISION_PROVIDER", "openrouter")
VISION_MODEL = env("VISION_MODEL", "nvidia/nemotron-nano-12b-v2-vl:free")
VISION_FALLBACK_MODEL = env("VISION_FALLBACK_MODEL", "google/gemma-3-27b-it:free")
STT_LOW_CONF = float(env("STT_LOW_CONF", "0.55"))  # segments below this confidence are flagged
SECOND_READER = env("SECOND_READER", "off").lower() == "on"
SECOND_READER_PROVIDER = env("SECOND_READER_PROVIDER", "groq")
SECOND_READER_MODEL = env("SECOND_READER_MODEL", "openai/gpt-oss-20b")
SECOND_READER_MAX_TOKENS = int(env("SECOND_READER_MAX_TOKENS", "2500"))
SECOND_READER_TIMEOUT = int(env("SECOND_READER_TIMEOUT", "60"))

# Demo accounts only. Roles are enforced by the API, but this is not production authentication.
DEMO_PASSWORD = env("DEMO_PASSWORD", "careflow-demo")
SESSION_TTL_HOURS = float(env("SESSION_TTL_HOURS", "8"))
USERS = {"intake1": "intake", "reviewer1": "reviewer", "reviewer2": "reviewer", "admin1": "admin"}
CORS_ORIGINS = [o.strip() for o in env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
# Vercel preview deployments get unique hostnames; allow them with a regex, e.g. https://careflow-.*\.vercel\.app
CORS_ORIGIN_REGEX = env("CORS_ORIGIN_REGEX") or None

# Live interview copilot: a small, fast model suggests the next questions while intake is typing or speaking.
# Deterministic rule-based questions are always returned first, so the copilot keeps working without a key.
COPILOT_PROVIDER = env("COPILOT_PROVIDER", "groq")
COPILOT_MODEL = env("COPILOT_MODEL", "llama-3.1-8b-instant")
COPILOT_TIMEOUT = float(env("COPILOT_TIMEOUT", "8"))
COPILOT_LLM = env("COPILOT_LLM", "on").lower() == "on"

# Provider response cache for reliable demos: off | record | replay | auto (replay when cached, else live + record).
LLM_CACHE = env("LLM_CACHE", "off").lower()
LLM_CACHE_PATH = Path(env("LLM_CACHE_PATH", str(BASE / "data" / "llm_cache.jsonl")))

# Seed synthetic demo cases on startup when the database is empty (useful on hosts with ephemeral disks).
SEED_DEMO = env("SEED_DEMO", "off").lower() == "on"
APP_VERSION = "2.0.0"
