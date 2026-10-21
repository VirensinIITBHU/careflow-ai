import unittest
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import audit, config, db
from app.routers import auth, cases, review
from app.schemas import Case, Consent, Flag, Override, Source, Symptom, now
from app.auth import User, require
from tests.helpers import fresh_db


def put_case(**kwargs):
    case = Case(consent=Consent(obtained=True, version="test", at=now()), **kwargs)
    with db.tx() as c:
        db.put_case(c, case)
    return case


def actions(case_id):
    c = db.connect()
    try:
        return [(r["action"], r["details"]) for r in c.execute(
            "SELECT action, details FROM audit WHERE case_id=? ORDER BY seq", (case_id,))]
    finally:
        c.close()


class BackendAdditionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()
        self.intake = User(username="intake1", role="intake")
        self.reviewer = User(username="reviewer1", role="reviewer")
        self.reviewer2 = User(username="reviewer2", role="reviewer")
        self.admin = User(username="admin1", role="admin")

    def tearDown(self):
        self.tmp.cleanup()

    def test_intake_ownership_and_withdrawal_policy(self):
        other = put_case(created_by="intake2")
        with self.assertRaises(HTTPException) as get_error:
            cases.get_case(other.case_id, self.intake)
        self.assertEqual(get_error.exception.status_code, 404)
        with self.assertRaises(HTTPException) as delete_error:
            cases.withdraw(other.case_id, self.intake)
        self.assertEqual(delete_error.exception.status_code, 404)

        reviewed = put_case(created_by="intake1", status="approved", final_note="final")
        with self.assertRaises(HTTPException) as reviewed_error:
            cases.withdraw(reviewed.case_id, self.intake)
        self.assertEqual(reviewed_error.exception.status_code, 409)
        self.assertEqual(cases.withdraw(reviewed.case_id, self.admin)["status"], "withdrawn")

        active = put_case(created_by="intake1", patient_ref="P-123")
        self.assertEqual(cases.withdraw(active.case_id, self.intake)["status"], "withdrawn")
        c = db.connect()
        try:
            tombstone = db.get_case(c, active.case_id)
        finally:
            c.close()
        self.assertIsNone(tombstone.patient_ref)

    def test_intake_view_redacts_stage_notes_and_only_returns_fixed_rejection_message(self):
        case = put_case(created_by="intake1", stages=[
            {"name": "extract", "status": "failed", "ms": 1, "note": "SECRET-PATIENT-TEXT"}])
        public = cases.get_case(case.case_id, self.intake)
        self.assertNotIn("SECRET-PATIENT-TEXT", str(public))
        self.assertNotIn("note", public["stages"][0])
        reviewer = cases.get_case(case.case_id, self.reviewer)
        self.assertIn("SECRET-PATIENT-TEXT", str(reviewer))

        rejected = put_case(created_by="intake1", status="rejected", reviewer_note="private reviewer comment",
                            reject_code="unclear_audio")
        message = cases.get_case(rejected.case_id, self.intake)
        self.assertIn("re-record", message["rejection_message"])
        self.assertNotIn("private reviewer comment", str(message))

    def test_case_view_and_file_reads_are_deduplicated_in_audit(self):
        case = put_case(created_by="intake1", sources=[Source(source_id="src1", kind="audio",
                          filename="voice.wav", stored_name="src1.wav")])
        cases.get_case(case.case_id, self.intake)
        cases.get_case(case.case_id, self.reviewer)
        cases.get_case(case.case_id, self.reviewer)
        folder = config.UPLOAD_DIR / case.case_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "src1.wav").write_bytes(b"audio")
        cases.source_file(case.case_id, "src1", self.reviewer)
        cases.source_file(case.case_id, "src1", self.reviewer)
        case_actions = [a for a, _ in actions(case.case_id)]
        self.assertEqual(case_actions.count("case_viewed"), 1)
        self.assertEqual(case_actions.count("source_downloaded"), 1)
        c = db.connect()
        try:
            self.assertTrue(audit.verify(c)["ok"])
        finally:
            c.close()

    def test_mine_queue_stats_and_patient_reference_validation(self):
        older = put_case(created_by="intake1", patient_ref="patient.1")
        newer = put_case(created_by="intake1", created_at="9999-01-01T00:00:00+00:00")
        put_case(created_by="intake2")
        mine = cases.my_cases(self.intake)
        self.assertEqual([x["case_id"] for x in mine], [newer.case_id, older.case_id])
        self.assertNotIn("patient_ref", mine[0])

        response = cases.create_case(BackgroundTasks(), True, None, "REF-01", "I feel unwell", None, None, self.intake)
        self.assertEqual(response["status"], "processing")
        c = db.connect()
        try:
            saved = db.get_case(c, response["case_id"])
        finally:
            c.close()
        self.assertEqual(saved.patient_ref, "REF-01")
        with self.assertRaises(HTTPException) as invalid:
            cases.create_case(BackgroundTasks(), True, None, "patient name", "I feel unwell", None, None, self.intake)
        self.assertEqual(invalid.exception.status_code, 400)

        processing = cases.list_cases(self.reviewer)
        listed = next(x for x in processing if x["case_id"] == response["case_id"])
        self.assertIsNone(listed["effective_tier"])
        self.assertIsNone(listed["system_tier"])
        self.assertEqual(listed["patient_ref"], "REF-01")
        self.assertEqual(listed["source_kinds"], ["text"])
        self.assertIsNone(listed["stage"])
        self.assertNotIn("REF-01", str(actions(response["case_id"])))
        override_case = put_case(status="needs_review", system_tier="immediate",
                                 tier_override=Override(tier="urgent", reason="reviewed context",
                                                       by="reviewer1", at=now()))
        override_item = next(x for x in cases.list_cases(self.reviewer) if x["case_id"] == override_case.case_id)
        self.assertEqual((override_item["effective_tier"], override_item["system_tier"]), ("urgent", "immediate"))
        self.assertEqual(override_item["override"]["tier"], "urgent")
        immediate = put_case(status="needs_review", system_tier="immediate")
        stats = cases.case_stats(self.reviewer)
        self.assertGreaterEqual(stats["processing"], 1)
        self.assertGreaterEqual(stats["open_by_tier"]["immediate"], 1)
        self.assertGreaterEqual(stats["open_by_tier"]["urgent"], 1)
        self.assertGreaterEqual(stats["unclaimed_immediate"], 1)
        with self.assertRaises(HTTPException) as denied:
            require("reviewer", "admin")(self.intake)
        self.assertEqual(denied.exception.status_code, 403)

    def test_session_expiry_logout_and_failed_login_audit(self):
        with db.tx() as c:
            token = db.new_session(c, "reviewer1", "reviewer")
            old = (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat()
            c.execute("UPDATE sessions SET created_at=? WHERE token=?", (old, token))
        self.assertIsNone(db.session_user(token))
        with self.assertRaises(HTTPException) as expired:
            auth.current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))
        self.assertEqual(expired.exception.status_code, 401)

        logged_in = auth.login(auth.Login(username="reviewer1", password=config.DEMO_PASSWORD))
        self.assertIsNotNone(db.session_user(logged_in["token"]))
        auth.logout(token=logged_in["token"], user=self.reviewer)
        self.assertIsNone(db.session_user(logged_in["token"]))
        with self.assertRaises(HTTPException) as logged_out:
            auth.current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=logged_in["token"]))
        self.assertEqual(logged_out.exception.status_code, 401)
        with self.assertRaises(HTTPException):
            auth.login(auth.Login(username="unknown\nuser", password="wrong"))
        c = db.connect()
        try:
            self.assertTrue(audit.verify(c)["ok"])
            event = c.execute("SELECT actor FROM audit WHERE action='login_failed'").fetchone()
        finally:
            c.close()
        self.assertEqual(event["actor"], "unknownuser")

    def test_new_optional_fields_load_legacy_case_documents(self):
        legacy = Case.model_validate_json('{"consent":{"obtained":true,"version":"old","at":"2020-01-01T00:00:00+00:00"},'
                                          '"sources":[{"source_id":"src-old","kind":"text","text":"hello"}]}')
        self.assertIsNone(legacy.patient_ref)
        self.assertEqual(legacy.annotations, [])
        self.assertIsNone(legacy.referral)
        self.assertIsNone(legacy.sources[0].language_status)
        self.assertIsNone(legacy.sources[0].text_en)

    def test_reject_code_release_claim_conflict_and_referral(self):
        rejected = put_case(created_by="intake1", status="needs_review")
        review.reject(rejected.case_id, review.Reject(reason="private reason", code="illegible_report"), self.reviewer)
        intake_view = cases.get_case(rejected.case_id, self.intake)
        self.assertIn("clearer copy", intake_view["rejection_message"])
        self.assertNotIn("private reason", str(intake_view))
        generic = put_case(created_by="intake1", status="needs_review")
        review.reject(generic.case_id, review.Reject(reason="reviewed"), self.reviewer)
        self.assertIn("could not be used", cases.get_case(generic.case_id, self.intake)["rejection_message"])

        resolved_flag = Flag(kind="quality", code="Q", title="Checked", rationale="Reviewed", resolved=True)
        claimed = put_case(status="in_review", reviewer_username="reviewer1", flags=[resolved_flag])
        with self.assertRaises(HTTPException) as conflict:
            review.start(claimed.case_id, self.reviewer2)
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertIn("already in review by reviewer1", conflict.exception.detail)
        with self.assertRaises(HTTPException) as release_conflict:
            review.release(claimed.case_id, self.reviewer2)
        self.assertEqual(release_conflict.exception.status_code, 409)
        released = review.release(claimed.case_id, self.reviewer)
        self.assertEqual((released["status"], released["reviewer_username"]), ("needs_review", None))
        self.assertTrue(released["flags"][0]["resolved"])
        self.assertEqual(review.start(claimed.case_id, self.reviewer2)["reviewer_username"], "reviewer2")

        ready = put_case(status="in_review", reviewer_username="reviewer1", ai_draft_note="DRAFT")
        approved = review.approve(ready.case_id, review.Approve(text="Human final", referral_to="Clinic",
                                    referral_urgency="soon", follow_up_in="1 week"), self.reviewer)
        self.assertEqual(approved["final_note"], "Human final")
        self.assertEqual(approved["referral"]["urgency"], "soon")
        self.assertTrue(actions(ready.case_id)[-1][1].find("soon") >= 0)

    def test_annotations_are_overlays_and_audit_details_are_parsed_and_filtered(self):
        case = put_case(status="in_review", reviewer_username="reviewer1", ai_draft_note="unchanged draft",
                        symptoms=[Symptom(name="headache")])
        before = case
        with self.assertRaises(HTTPException) as assignment:
            review.annotate(case.case_id, review.AnnotationIn(target_type="symptom", target_index=0,
                                  action="disputed", comment="Other reviewer comment"), self.reviewer2)
        self.assertEqual(assignment.exception.status_code, 409)
        annotated = review.annotate(case.case_id, review.AnnotationIn(target_type="symptom", target_index=0,
                                      action="corrected", comment="Check this symptom", correction="mild headache"),
                                   self.reviewer)
        self.assertEqual(annotated["symptoms"][0]["name"], before.symptoms[0].name)
        self.assertEqual(annotated["ai_draft_note"], "unchanged draft")
        self.assertEqual(annotated["annotations"][0]["correction"], "mild headache")
        with self.assertRaises(HTTPException) as invalid_target:
            review.annotate(case.case_id, review.AnnotationIn(target_type="symptom", target_index=4,
                                  action="disputed", comment="No such symptom"), self.reviewer)
        self.assertEqual(invalid_target.exception.status_code, 404)
        c = db.connect()
        try:
            event = c.execute("SELECT details FROM audit WHERE action='annotation_added'").fetchone()
        finally:
            c.close()
        self.assertNotIn("Check this symptom", event["details"])

        global_events = review.audit_log(case_id=case.case_id, user=self.admin)
        self.assertTrue(all(isinstance(item["details"], dict) for item in global_events))
        self.assertTrue(all(item["case_id"] == case.case_id for item in global_events))
        actor_events = review.audit_log(actor="reviewer1", user=self.admin)
        self.assertTrue(all(item["actor"] == "reviewer1" for item in actor_events))


if __name__ == "__main__":
    unittest.main()
