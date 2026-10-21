"""Submit the repository's synthetic text and audio examples through the public HTTP API."""
import argparse
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--password", default="careflow-demo")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    print("This runs the real pipeline and needs the configured model-provider API keys in backend/.env. Synthetic samples only.")

    with httpx.Client(base_url=base, timeout=30) as client:
        login = client.post("/auth/login", json={"username": "intake1", "password": args.password})
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        samples = [("text", p) for p in sorted((ROOT / "samples" / "text").glob("*.txt"))]
        samples += [("audio", p) for p in sorted((ROOT / "samples" / "audio").glob("*.ogg"))]
        if not samples:
            print("No text or .ogg audio samples found.", file=sys.stderr)
            return 1

        results = []
        for kind, path in samples:
            if kind == "text":
                response = client.post("/cases", data={"consent": "true", "text": path.read_text(encoding="utf-8")},
                                       headers=headers)
            else:
                with path.open("rb") as fh:
                    response = client.post("/cases", data={"consent": "true", "language_hint": "hi"},
                                           files={"audio": (path.name, fh, "audio/ogg")}, headers=headers)
            response.raise_for_status()
            case_id = response.json()["case_id"]
            status = "processing (timeout)"
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                current = client.get(f"/cases/{case_id}", headers=headers)
                current.raise_for_status()
                status = current.json()["status"]
                if status != "processing":
                    break
                time.sleep(3)
            results.append((case_id, path.name, status))

    print(f"{'CASE ID':<16} {'INPUT':<30} STATUS")
    for case_id, name, status in results:
        print(f"{case_id:<16} {name:<30} {status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
