import os, sys, time, httpx
B = "http://127.0.0.1:8000"
AUDIO = (".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac")
def login(u):
    r = httpx.post(f"{B}/auth/login", json={"username": u, "password": "careflow-demo"})
    return {"Authorization": "Bearer " + r.json()["token"]}
intake, rev = login("intake1"), login("reviewer1")
for path in sys.argv[1:]:
    if path.lower().endswith(AUDIO):
        r = httpx.post(f"{B}/cases", data={"consent": "true"}, headers=intake, timeout=30,
                       files={"audio": (os.path.basename(path), open(path, "rb"))})
    else:
        r = httpx.post(f"{B}/cases", data={"consent": "true", "text": open(path, encoding="utf-8").read()}, headers=intake)
    r.raise_for_status()
    cid = r.json()["case_id"]
    for _ in range(90):
        c = httpx.get(f"{B}/cases/{cid}", headers=rev).json()
        if c["status"] != "processing":
            break
        time.sleep(1)
    print(f"\n== {path}\n{cid}  status={c['status']}  tier={c['effective_tier']}  languages={c['detected_languages']}")
    for s in c["stages"]:
        print(f"  stage {s['name']:<22}{s['status']:<8}{s['ms']:>6} ms  {s.get('note') or ''}")
    for s in c["symptoms"]:
        print(f"  symptom: {s['name']} [{s['status']}{', denied' if s['negated'] else ''}] <- \"{s['evidence'][0]['quote']}\"")
    for f in c["flags"]:
        ev = f["evidence"][0] if f["evidence"] else {}
        t = f" @{ev['t_start_ms']}ms" if ev.get("t_start_ms") is not None else ""
        print(f"  flag [{f['tier']}/{f['kind']}] {f['code']}: {f['title']}{t}")
    print("  follow-ups:", [(f["question"], f["question_local"]) for f in c["followups"]][:3])
    print("  draft:\n    " + (c["ai_draft_note"] or "").replace("\n", "\n    "))
