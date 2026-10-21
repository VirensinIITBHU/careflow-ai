import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import TEXT, fake_llm, fresh_db

client = TestClient(app)


def login(user):
    r = client.post("/auth/login", json={"username": user, "password": "careflow-demo"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


class ReviewFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()
        self.intake, self.rev1, self.rev2, self.admin = (login(u) for u in ("intake1", "reviewer1", "reviewer2", "admin1"))

    def tearDown(self):
        self.tmp.cleanup()

    def create(self):
        with patch("app.llm.chat_json", side_effect=fake_llm):
            r = client.post("/cases", data={"consent": "true", "text": TEXT}, headers=self.intake)
        self.assertEqual(r.status_code, 202, r.text)
        return r.json()["case_id"]

    def test_login_rejects_bad_password(self):
        self.assertEqual(client.post("/auth/login", json={"username": "intake1", "password": "x"}).status_code, 401)

    def test_consent_is_required(self):
        r = client.post("/cases", data={"consent": "false", "text": TEXT}, headers=self.intake)
        self.assertEqual(r.status_code, 400)

    def test_roles_restrict_access(self):
        cid = self.create()
        self.assertEqual(client.get("/cases", headers=self.intake).status_code, 403)
        self.assertEqual(client.get("/cases").status_code, 401)
        limited = client.get(f"/cases/{cid}", headers=self.intake).json()
        self.assertNotIn("symptoms", limited)
        self.assertEqual(client.get("/audit/verify", headers=self.rev1).status_code, 403)

    def test_queue_is_prioritized(self):
        self.create()
        q = client.get("/cases", headers=self.rev1).json()
        self.assertEqual(q[0]["effective_tier"], "immediate")
        self.assertIn("Breathing difficulty mentioned", q[0]["top_flags"])

    def test_approval_needs_resolved_flags_then_succeeds_and_keeps_draft(self):
        cid = self.create()
        self.assertEqual(client.post(f"/cases/{cid}/approve", json={"text": "ok"}, headers=self.rev1).status_code, 409)
        case = client.post(f"/cases/{cid}/review/start", headers=self.rev1).json()
        r = client.post(f"/cases/{cid}/approve", json={"text": "Reviewed."}, headers=self.rev1)
        self.assertEqual(r.status_code, 409)
        self.assertIn("unresolved", r.json()["detail"])
        for f in case["flags"]:
            rr = client.post(f"/cases/{cid}/flags/{f['flag_id']}/resolve",
                             json={"action": "acknowledged", "reason": "Reviewed with source text"}, headers=self.rev1)
            self.assertEqual(rr.status_code, 200, rr.text)
        draft = case["ai_draft_note"]
        done = client.post(f"/cases/{cid}/approve", json={"text": "Final note by reviewer."}, headers=self.rev1).json()
        self.assertEqual(done["status"], "approved")
        self.assertEqual(done["final_note"], "Final note by reviewer.")
        self.assertEqual(done["ai_draft_note"], draft)
        self.assertEqual(done["audit_events"][-1]["action"], "approved")
        self.assertTrue(done["audit_events"][-1]["details"]["edited_from_ai_draft"])
        self.assertTrue(client.get("/audit/verify", headers=self.admin).json()["ok"])

    def test_extraction_failure_keeps_approval_blocked(self):
        with patch("app.llm.chat_json", side_effect=RuntimeError("provider down")):
            r = client.post("/cases", data={"consent": "true", "text": "I feel unwell."}, headers=self.intake)
        self.assertEqual(r.status_code, 202, r.text)
        cid = r.json()["case_id"]
        case = client.post(f"/cases/{cid}/review/start", headers=self.rev1).json()
        self.assertTrue(case["extraction_failed"])
        denied = client.post(f"/cases/{cid}/approve", json={"text": "Reviewed."}, headers=self.rev1)
        self.assertEqual(denied.status_code, 409)
        self.assertIn("processing failed", denied.json()["detail"])

    def test_only_assigned_reviewer_can_act(self):
        cid = self.create()
        client.post(f"/cases/{cid}/review/start", headers=self.rev1)
        r = client.put(f"/cases/{cid}/note", json={"text": "x"}, headers=self.rev2)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(client.post(f"/cases/{cid}/review/start", headers=self.rev2).status_code, 409)

    def test_priority_override_requires_reason_and_is_audited(self):
        cid = self.create()
        client.post(f"/cases/{cid}/review/start", headers=self.rev1)
        self.assertEqual(client.post(f"/cases/{cid}/priority", json={"tier": "urgent", "reason": ""}, headers=self.rev1).status_code, 422)
        r = client.post(f"/cases/{cid}/priority", json={"tier": "urgent", "reason": "Patient is stable"}, headers=self.rev1).json()
        self.assertEqual((r["effective_tier"], r["system_tier"]), ("urgent", "immediate"))
        self.assertEqual(r["audit_events"][-1]["action"], "priority_overridden")

    def test_withdrawal_erases_content_but_audit_chain_stays_valid(self):
        cid = self.create()
        self.assertEqual(client.delete(f"/cases/{cid}", headers=self.intake).status_code, 200)
        self.assertEqual(client.get(f"/cases/{cid}", headers=self.rev1).status_code, 404)
        self.assertEqual(client.get("/cases", headers=self.rev1).json(), [])
        self.assertTrue(client.get("/audit/verify", headers=self.admin).json()["ok"])

    def test_audio_case_links_evidence_to_timestamps_and_flags_low_confidence(self):
        stt = {"language": "hi", "text": "x", "segments": [
            {"start": 0.0, "end": 2.5, "text": " Mujhe bukhar hai", "avg_logprob": -0.2, "no_speech_prob": 0.01},
            {"start": 2.5, "end": 6.0, "text": " aur saans lene mein dikkat hai", "avg_logprob": -1.8, "no_speech_prob": 0.1}]}
        ext = {"language": "hinglish", "symptoms": [{"name": "breathing difficulty", "status": "current",
               "quote": "saans lene mein dikkat hai"}], "facts": [], "followups": [], "uncertainties": []}
        with patch("app.llm.transcribe", return_value=stt), patch("app.llm.chat_json", return_value=ext):
            r = client.post("/cases", data={"consent": "true"}, headers=self.intake,
                            files={"audio": ("voice.wav", b"RIFFdemo", "audio/wav")})
        self.assertEqual(r.status_code, 202, r.text)
        case = client.get(f"/cases/{r.json()['case_id']}", headers=self.rev1).json()
        self.assertEqual(case["system_tier"], "immediate")
        ev = next(f for f in case["flags"] if f["code"] == "breathing_difficulty")["evidence"][0]
        self.assertEqual((ev["t_start_ms"], ev["t_end_ms"]), (2500, 6000))
        self.assertIn("LOW_CONFIDENCE_TRANSCRIPTION", {f["code"] for f in case["flags"]})
        self.assertEqual(client.get(f"/cases/{case['case_id']}/sources/{case['sources'][0]['source_id']}/file",
                                    headers=self.rev1).status_code, 200)


if __name__ == "__main__":
    unittest.main()
