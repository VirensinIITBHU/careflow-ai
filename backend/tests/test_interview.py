"""Live interview copilot: instant questions, guardrails, sessions, WebSocket, submission into the pipeline."""
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import config, db
from app.copilot import model, rules
from app.main import app
from tests.helpers import fresh_db

client = TestClient(app)


def login(user):
    r = client.post("/auth/login", json={"username": user, "password": "careflow-demo"})
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["token"]


MODEL_OUT = {"questions": [
    {"question_en": "Have you noticed any wheezing when you breathe?", "question_local": None, "reason": "r", "slot": "x"},
    {"question_en": "You may have an infection, should you take antibiotics?", "question_local": None, "reason": "bad"},
    {"question_en": "Don't worry, it is nothing serious. Any cough?", "reason": "bad"},
], "symptoms": [{"name": "breathlessness", "quote": "difficulty breathing"},
                {"name": "made up", "quote": "this text is not in the conversation"}]}

EXTRACTION = {"language": "en", "symptoms": [
    {"name": "fever", "status": "current", "quote": "fever since yesterday", "onset": "since yesterday"},
    {"name": "chest pain", "status": "current", "negated": True, "quote": "No"}],
    "facts": [], "followups": [], "uncertainties": []}


class InstantRulesTests(unittest.TestCase):
    def test_empty_conversation_opens_with_main_problem(self):
        a = rules.analyse([], set(), set())
        self.assertEqual(a["questions"][0].key, "opener")

    def test_warning_sign_question_comes_first_and_from_policy(self):
        a = rules.analyse(["I have had fever since yesterday and difficulty breathing."], set(), set())
        q = a["questions"][0]
        self.assertEqual((q.kind, q.origin, q.key), ("redflag", "policy", "redflag:breathing_difficulty"))
        self.assertTrue(a["warning_signs"])

    def test_stated_details_are_not_asked_again(self):
        a = rules.analyse(["I have had a mild fever since yesterday. I am 30 years old."], set(), set())
        keys = {q.key for q in a["questions"]}
        self.assertNotIn("onset:fever", keys)
        self.assertNotIn("severity:fever", keys)
        self.assertNotIn("age:patient", keys)
        self.assertIn("medications:patient", keys)

    def test_denied_symptom_is_not_asked_about(self):
        a = rules.analyse(["No fever. I have a cough since two days."], set(), set())
        keys = {q.key for q in a["questions"]}
        self.assertFalse(any(k.endswith(":fever") for k in keys))
        self.assertIn(("fever", "denied"), {(s["name"], s["status"]) for s in a["symptoms"]})

    def test_answered_and_skipped_questions_disappear_and_fill_completeness(self):
        text = ["I have a cough."]
        before = rules.analyse(text, set(), set())
        after = rules.analyse(text, {"onset:cough", "age:patient"}, {"medications:patient"})
        keys = {q.key for q in after["questions"]}
        self.assertFalse({"onset:cough", "age:patient", "medications:patient"} & keys)
        self.assertGreater(after["completeness"]["filled"], before["completeness"]["filled"])

    def test_hinglish_and_hindi_questions_are_localized(self):
        a = rules.analyse(["Mujhe kal se bukhar hai aur bahut khansi hai"], set(), set())
        self.assertEqual(a["language"], "hinglish")
        self.assertTrue(all(q.text_local for q in a["questions"]))
        h = rules.analyse(["मुझे बुखार है"], set(), set())
        self.assertEqual(h["language"], "hi")
        self.assertIn("बुखार", h["questions"][0].text_local)


class ModelGuardrailTests(unittest.TestCase):
    def setUp(self):
        model._memo.clear()

    def test_unsafe_questions_and_ungrounded_symptoms_are_dropped(self):
        with patch("app.llm.chat_json", return_value=MODEL_OUT):
            out = model.suggest([{"said": "I have difficulty breathing"}], "", "en", [], "I have difficulty breathing")
        self.assertEqual([q.text_en for q in out["questions"]], ["Have you noticed any wheezing when you breathe?"])
        self.assertEqual(out["blocked"], 2)
        self.assertEqual([s["name"] for s in out["symptoms"]], ["breathlessness"])

    def test_duplicates_of_planned_questions_are_dropped(self):
        with patch("app.llm.chat_json", return_value=MODEL_OUT):
            out = model.suggest([], "", "en", ["Have you noticed wheezing when you breathe?"], "x")
        self.assertEqual(out["questions"], [])

    def test_model_failure_degrades_to_rules(self):
        with patch("app.llm.chat_json", side_effect=RuntimeError("down")):
            out = model.suggest([], "", "en", [], "")
        self.assertEqual((out["status"], out["questions"]), ("error", []))


class InterviewApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()
        config.COPILOT_LLM = True
        model._memo.clear()
        (self.intake, self.itoken), (self.rev, _) = login("intake1"), login("reviewer1")

    def tearDown(self):
        self.tmp.cleanup()

    def start(self):
        r = client.post("/intake/sessions", json={"consent": True}, headers=self.intake)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def test_consent_required_and_reviewers_cannot_interview(self):
        self.assertEqual(client.post("/intake/sessions", json={"consent": False}, headers=self.intake).status_code, 400)
        self.assertEqual(client.post("/intake/sessions", json={"consent": True}, headers=self.rev).status_code, 403)

    def test_full_interview_to_reviewed_case(self):
        data = self.start()
        sid = data["session"]["session_id"]
        self.assertEqual(data["suggestions"]["questions"][0]["key"], "opener")
        r = client.post(f"/intake/sessions/{sid}/turns", data={"text": "I have fever since yesterday."},
                        headers=self.intake).json()
        q = next(x for x in r["suggestions"]["questions"] if x["key"] == "severity:fever")
        with patch("app.llm.chat_json", return_value=MODEL_OUT):
            sug = client.post(f"/intake/sessions/{sid}/suggest", json={"draft": "and difficulty breathing"},
                              headers=self.intake).json()
        self.assertEqual(sug["questions"][0]["kind"], "redflag")
        self.assertIn("model", {x["origin"] for x in sug["questions"]})
        chest = {"id": "qx", "key": "model:chest", "kind": "model", "origin": "model",
                 "text_en": "Do you have chest pain?", "lang": "en"}
        client.post(f"/intake/sessions/{sid}/turns", data={"text": "No", "question": json.dumps(chest)},
                    headers=self.intake)
        r = client.post(f"/intake/sessions/{sid}/turns", data={"text": "Mild", "question": json.dumps(q)},
                        headers=self.intake).json()
        self.assertNotIn("severity:fever", {x["key"] for x in r["suggestions"]["questions"]})
        client.post(f"/intake/sessions/{sid}/skip", json={"key": "age:patient"}, headers=self.intake)
        with patch("app.llm.chat_json", return_value=EXTRACTION) as llm:
            r = client.post(f"/intake/sessions/{sid}/submit", headers=self.intake)
        self.assertEqual(r.status_code, 202, r.text)
        self.assertNotIn("sources", r.json())  # intake sees operational status only
        payload = json.loads(llm.call_args_list[0].args[3])
        self.assertIn("interview_questions", payload["sources"][0])
        case = client.get(f"/cases/{r.json()['case_id']}", headers=self.rev).json()
        src = case["sources"][0]
        self.assertNotIn("Do you have chest pain", src["text"])  # questions are metadata, never screened text
        self.assertEqual(len(src["prompts"]), 2)
        statuses = {x["question"]["key"]: x["status"] for x in case["interview"]}
        self.assertEqual(statuses["severity:fever"], "answered")
        self.assertEqual(statuses["age:patient"], "skipped")
        self.assertTrue(any(s["name"] == "chest pain" and s["negated"] for s in case["symptoms"]))
        self.assertEqual(client.post(f"/intake/sessions/{sid}/submit", headers=self.intake).status_code, 409)

    def test_other_intake_users_cannot_see_a_session(self):
        sid = self.start()["session"]["session_id"]
        admin, _ = login("admin1")
        self.assertEqual(client.get(f"/intake/sessions/{sid}", headers=admin).status_code, 200)
        with db.tx() as c:
            s = db.get_session(c, sid)
            s.created_by = "someone_else"
            db.put_session(c, s)
        self.assertEqual(client.get(f"/intake/sessions/{sid}", headers=self.intake).status_code, 404)

    def test_websocket_sends_rules_then_model(self):
        sid = self.start()["session"]["session_id"]
        with patch("app.llm.chat_json", return_value=MODEL_OUT):
            with client.websocket_connect(f"/intake/sessions/{sid}/live?token={self.itoken}") as ws:
                ws.send_json({"type": "draft", "seq": 1, "text": "I have chest pain since an hour"})
                first = ws.receive_json()
                self.assertEqual((first["phase"], first["seq"]), ("rules", 1))
                self.assertEqual(first["questions"][0]["key"], "redflag:chest_pain")
                second = ws.receive_json()
                self.assertEqual(second["phase"], "model")
                self.assertIn("model", {q["origin"] for q in second["questions"]})

    def test_websocket_rejects_bad_token(self):
        sid = self.start()["session"]["session_id"]
        with self.assertRaises(Exception):
            with client.websocket_connect(f"/intake/sessions/{sid}/live?token=nope") as ws:
                ws.receive_json()

    def test_discard_erases_content(self):
        sid = self.start()["session"]["session_id"]
        client.post(f"/intake/sessions/{sid}/turns", data={"text": "cough"}, headers=self.intake)
        client.delete(f"/intake/sessions/{sid}", headers=self.intake)
        s = client.get(f"/intake/sessions/{sid}", headers=self.intake).json()["session"]
        self.assertEqual((s["status"], s["turns"]), ("discarded", []))


class SeedAndInsightsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()
        self.rev, _ = login("reviewer1")

    def tearDown(self):
        self.tmp.cleanup()

    def test_seed_metrics_and_eval(self):
        from app import demo
        with patch("app.llm.chat_json", side_effect=AssertionError("seeding must not call models")):
            self.assertEqual(demo.seed_if_empty(), 5)
            self.assertEqual(demo.seed_if_empty(), 0)
        queue = client.get("/cases", headers=self.rev).json()
        tiers = [x["effective_tier"] for x in queue]
        self.assertEqual(tiers.count("immediate"), 3)
        self.assertIn("approved", {x["status"] for x in queue})
        iv = next(x for x in queue if x["case_id"] and client.get(f"/cases/{x['case_id']}", headers=self.rev).json()["interview"])
        full = client.get(f"/cases/{iv['case_id']}", headers=self.rev).json()
        self.assertTrue(any(f["code"] == "breathing_difficulty" for f in full["flags"]))
        m = client.get("/metrics", headers=self.rev).json()
        self.assertEqual(m["totals"]["cases"], 5)
        self.assertEqual(m["interview"]["cases"], 1)
        e = client.get("/eval/rules", headers=self.rev).json()
        self.assertGreater(e["cases"], 100)
        self.assertFalse(e["clinically_validated"])

    def test_health_reports_no_secrets(self):
        h = client.get("/health").json()
        self.assertEqual(h["status"], "ok")
        self.assertNotIn("key", json.dumps(h["providers"]).lower().replace("huggingface", ""))
