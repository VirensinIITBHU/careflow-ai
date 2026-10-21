import unittest
from threading import Barrier
from unittest.mock import patch

from app import db
from app.pipeline import orchestrator, translate
from app.safety import engine
from app.schemas import Case, Consent, Fact, FollowUp, Source, Span, Symptom, now
from tests.helpers import TEXT, fake_llm, fresh_db


def make_case():
    case = Case(consent=Consent(obtained=True, version="t", at=now()),
                sources=[Source(source_id="src-1", kind="text", text=TEXT)])
    with db.tx() as c:
        db.put_case(c, case)
    return case.case_id


def load(case_id):
    c = db.connect()
    try:
        return db.get_case(c, case_id)
    finally:
        c.close()


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()

    def tearDown(self):
        self.tmp.cleanup()

    def test_full_pipeline_with_mocked_model(self):
        cid = make_case()
        with patch("app.llm.chat_json", side_effect=fake_llm):
            orchestrator.run(cid)
        case = load(cid)
        self.assertEqual(case.status, "needs_review")
        self.assertEqual(case.system_tier, "immediate")
        codes = {f.code for f in case.flags}
        self.assertTrue({"breathing_difficulty", "chest_pain", "PROMPT_INJECTION_SUSPECTED", "UNSUPPORTED_QUOTE"} <= codes)
        self.assertNotIn("rash", [s.name for s in case.symptoms])  # fabricated quote dropped
        for s in case.symptoms:
            ev = s.evidence[0]
            self.assertEqual(TEXT[ev.start:ev.end], ev.quote)
        self.assertTrue(case.ai_draft_note.startswith("DRAFT"))
        self.assertIn("When did the difficulty breathing start, and how severe is it?", [f.question for f in case.followups])

    def test_extracted_hindi_fields_are_normalized_to_english_without_translating_evidence(self):
        quote = "मुझे कब्ज़ हो रही है"
        symptom = Symptom(name="कब्ज़", onset="कल से", evidence=[
            Span(source_id="src-1", start=0, end=len(quote), quote=quote)])
        fact = Fact(field="दवा", value="कोई नहीं", evidence=[
            Span(source_id="src-1", start=0, end=len(quote), quote=quote)])
        suggestions = [("दर्द कब शुरू हुआ?", "शुरुआत स्पष्ट करें")]
        uncertainties = ["समय स्पष्ट नहीं है"]
        response = {
            "symptoms": [{"name": "constipation", "onset": "since yesterday", "duration": None, "severity": None}],
            "facts": [{"field": "medication", "value": "none"}],
            "suggestions": [{"question": "When did the pain start?", "reason": "Clarify onset."}],
            "uncertainties": ["Timing is unclear."],
        }
        with patch("app.pipeline.translate.llm.chat_json", return_value=response):
            self.assertTrue(translate.extracted_fields_need_english([symptom], [fact], suggestions, uncertainties))
            translate.extracted_fields_to_english([symptom], [fact], suggestions, uncertainties)
        self.assertEqual((symptom.name, symptom.onset), ("constipation", "since yesterday"))
        self.assertEqual((fact.field, fact.value), ("medication", "none"))
        self.assertEqual(suggestions[0][0], "When did the pain start?")
        self.assertEqual(uncertainties, ["Timing is unclear."])
        self.assertEqual(symptom.evidence[0].quote, quote)

    def test_model_failure_fails_closed_but_rules_still_run(self):
        cid = make_case()
        with patch("app.llm.chat_json", side_effect=RuntimeError("provider down")):
            orchestrator.run(cid)
        case = load(cid)
        self.assertTrue(case.extraction_failed)
        self.assertEqual(case.system_tier, "immediate")  # rules need no model
        self.assertIn("EXTRACTION_FAILED", {f.code for f in case.flags})

    def test_extraction_uses_configured_fallback_after_primary_failure(self):
        cid = make_case()
        result = ([], [], [], [], "en", [])
        with patch("app.config.EXTRACT_MODEL", "Qwen/Qwen3-4B-Instruct-2507"), \
             patch("app.config.EXTRACT_FALLBACK_MODEL", "Qwen/Qwen3-4B-Thinking-2507"), \
             patch("app.pipeline.extract.run", side_effect=[RuntimeError("primary down"), result]) as extract_call:
            orchestrator.run(cid)
        case = load(cid)
        self.assertFalse(case.extraction_failed)
        self.assertEqual(next(s.status for s in case.stages if s.name == "extract"), "failed")
        self.assertEqual(next(s.status for s in case.stages if s.name == "extract_fallback"), "done")
        self.assertEqual(extract_call.call_args_list[0].kwargs["model"], "Qwen/Qwen3-4B-Instruct-2507")
        self.assertEqual(extract_call.call_args_list[1].kwargs["model"], "Qwen/Qwen3-4B-Thinking-2507")

    def test_translation_fails_over_to_configured_model(self):
        with patch("app.config.EXTRACT_MODEL", "Qwen/Qwen3-4B-Instruct-2507"), \
             patch("app.config.EXTRACT_FALLBACK_MODEL", "Qwen/Qwen3-4B-Thinking-2507"), \
             patch("app.pipeline.translate.llm.chat_json", side_effect=[{"translations": []}, {
            "translations": ["नमस्ते"]
        }]) as call:
            result = translate.run([FollowUp(question="Hello?", reason="Test")], "hi")
        self.assertTrue(result)
        self.assertEqual(call.call_args_list[0].args[1], "Qwen/Qwen3-4B-Instruct-2507")
        self.assertEqual(call.call_args_list[1].args[1], "Qwen/Qwen3-4B-Thinking-2507")

    def test_audio_transcription_and_ocr_run_concurrently(self):
        case = Case(consent=Consent(obtained=True, version="t", at=now()), sources=[
            Source(source_id="audio-1", kind="audio", stored_name="audio.wav"),
            Source(source_id="report-1", kind="report", stored_name="report.png"),
        ])
        with db.tx() as c:
            db.put_case(c, case)

        barrier = Barrier(2)

        def process(src, *args):
            barrier.wait(timeout=2)
            src.text = "I have difficulty breathing."

        with patch("app.pipeline.transcribe.run", side_effect=process), \
             patch("app.pipeline.ocr.run", side_effect=process):
            orchestrator.run(case.case_id)

        done = load(case.case_id)
        self.assertTrue(all(s.text for s in done.sources))
        self.assertEqual({s.name: s.status for s in done.stages if s.name in ("transcribe", "ocr")},
                         {"transcribe": "done", "ocr": "done"})

    def test_ocr_uses_configured_vision_fallback(self):
        from app.pipeline import ocr

        src = Source(source_id="report-1", kind="report")
        response = {"text": "Readable report text", "illegible_regions": 0, "notes": ""}
        with patch("app.pipeline.ocr.config.VISION_MODEL", "primary-vision"), \
             patch("app.pipeline.ocr.config.VISION_FALLBACK_MODEL", "fallback-vision"), \
             patch("app.pipeline.ocr.llm.vision_json", side_effect=[RuntimeError("primary down"), response]) as vision:
            ocr.run(src, __import__("pathlib").Path("report.png"))
        self.assertEqual(src.text, "Readable report text")
        self.assertTrue(any("fallback model was used" in warning for warning in src.warnings))
        self.assertEqual([call.kwargs["model"] for call in vision.call_args_list],
                         ["primary-vision", "fallback-vision"])

    def test_ocr_falls_back_when_primary_returns_no_transcription(self):
        from app.pipeline import ocr

        src = Source(source_id="report-1", kind="report")
        classifier_output = {"text": "", "illegible_regions": 0, "notes": ""}  # e.g. a safety model's verdict
        good = {"text": "Hb 9.1 g/dL", "illegible_regions": 0, "notes": ""}
        with patch("app.pipeline.ocr.config.VISION_MODEL", "safety-model"), \
             patch("app.pipeline.ocr.config.VISION_FALLBACK_MODEL", "real-ocr-model"), \
             patch("app.pipeline.ocr.llm.vision_json", side_effect=[classifier_output, good]):
            ocr.run(src, __import__("pathlib").Path("report.png"))
        self.assertEqual(src.text, "Hb 9.1 g/dL")

    def test_vision_json_rejects_safety_verdict_and_accepts_prose(self):
        import tempfile
        from pathlib import Path
        from PIL import Image
        from app import llm

        with tempfile.TemporaryDirectory() as d:
            img = Path(d) / "r.png"
            Image.new("RGB", (20, 20), "white").save(img)
            def reply(text):
                return {"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}
            with patch("app.llm._provider", return_value=("https://example.invalid/v1", "k")):
                with patch("app.llm._post", return_value=reply('{"User Safety": "safe"}')):
                    with self.assertRaises(llm.LLMError):
                        llm.vision_json("p", img)
                with patch("app.llm._post", return_value=reply("User Safety: safe")):
                    with self.assertRaises(llm.LLMError):
                        llm.vision_json("p", img)
                with patch("app.llm._post", return_value=reply("Plain transcription of the report")):
                    self.assertEqual(llm.vision_json("p", img)["text"], "Plain transcription of the report")
                with patch("app.llm._post", return_value=reply('{"text": "Hb 9.1", "illegible_regions": 0}')):
                    self.assertEqual(llm.vision_json("p", img)["text"], "Hb 9.1")

    def test_groq_gpt_oss_request_shape(self):
        from app import llm
        response = {"choices": [{"message": {"content": '{"ok": true}'}}]}
        with patch("app.llm._provider", return_value=("https://example.invalid/v1", "k")), \
             patch("app.llm._post", return_value=response) as mock_post:
            llm.chat_json("groq", "openai/gpt-oss-20b", "sys", "usr")
        body = mock_post.call_args.kwargs["json"]
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_model_failure_still_screens_readable_source_text(self):
        cid = make_case()
        with patch("app.llm.chat_json", side_effect=RuntimeError("provider down")):
            orchestrator.run(cid)
        case = load(cid)
        self.assertTrue(case.extraction_failed)
        self.assertEqual(case.status, "needs_review")
        self.assertEqual(case.system_tier, "immediate")
        self.assertIn("breathing_difficulty", {f.code for f in case.flags})
        self.assertIn("safety_rules", {s.name for s in case.stages})

    def test_model_failure_still_screens_transcribed_and_ocr_text(self):
        for kind, processor in (("audio", "app.pipeline.transcribe.run"),
                                ("report", "app.pipeline.ocr.run")):
            with self.subTest(kind=kind):
                case = Case(consent=Consent(obtained=True, version="t", at=now()),
                            sources=[Source(source_id="src-1", kind=kind, text=None)])
                with db.tx() as c:
                    db.put_case(c, case)

                def readable_text(src, *args):
                    src.text = "I have difficulty breathing."

                with patch(processor, side_effect=readable_text), \
                     patch("app.llm.chat_json", side_effect=RuntimeError("provider down")):
                    orchestrator.run(case.case_id)

                done = load(case.case_id)
                self.assertTrue(done.extraction_failed)
                self.assertEqual(done.system_tier, "immediate")
                self.assertIn("breathing_difficulty", {f.code for f in done.flags})

    def test_no_flags_and_failed_extraction_is_undetermined_not_standard(self):
        case = Case(consent=Consent(obtained=True, version="t", at=now()),
                    sources=[Source(source_id="src-1", kind="text", text="I feel unwell.")])
        with db.tx() as c:
            db.put_case(c, case)
        with patch("app.llm.chat_json", side_effect=RuntimeError("down")):
            orchestrator.run(case.case_id)
        self.assertEqual(load(case.case_id).system_tier, "undetermined")


    def _tamil_case(self, negated):
        text = "எனக்கு மூச்சு விட சிரமமாக இருக்கிறது"  # "I have difficulty breathing" (no keyword rule covers Tamil)
        case = Case(consent=Consent(obtained=True, version="t", at=now()),
                    sources=[Source(source_id="src-1", kind="text", text=text)])
        with db.tx() as c:
            db.put_case(c, case)
        ext = {"language": "tamil", "symptoms": [{"name": "difficulty breathing", "status": "current",
               "negated": negated, "quote": "மூச்சு விட சிரமமாக"}], "facts": [], "followups": [], "uncertainties": []}
        with patch("app.llm.chat_json", return_value=ext):
            orchestrator.run(case.case_id)
        return load(case.case_id)

    def test_model_extracted_warning_sign_is_flagged_when_keyword_rules_miss_the_language(self):
        case = self._tamil_case(negated=False)
        flag = next(f for f in case.flags if f.kind == "safety")
        self.assertEqual((flag.code, flag.origin), ("breathing_difficulty", "model"))
        self.assertEqual(case.system_tier, "immediate")

    def test_denied_symptom_does_not_trigger_the_cross_check(self):
        self.assertEqual(self._tamil_case(negated=True).system_tier, "standard")

    def test_language_status_is_informational(self):
        for language, expected in (("en", "tested"), ("English", "tested"), ("hi", "tested"),
                                   ("Hindi-English", "tested"), ("ur", "uncertain"),
                                   ("Tamil", "untested"), (None, "uncertain")):
            with self.subTest(language=language):
                self.assertEqual(orchestrator.language_status(language), expected)

    def test_source_english_copy_keeps_original_text_for_evidence_and_screening(self):
        cid = make_case()

        def translate_source(src):
            src.text_en = "English reading copy"
            return True

        with patch("app.pipeline.extract.run", return_value=([], [], [], [], "Hindi", [])), \
             patch("app.pipeline.translate.to_english", side_effect=translate_source), \
             patch("app.safety.engine.screen", wraps=engine.screen) as screen:
            orchestrator.run(cid)
        case = load(cid)
        self.assertEqual(case.sources[0].text, TEXT)
        self.assertEqual(case.sources[0].text_en, "English reading copy")
        self.assertEqual(case.sources[0].language_status, "tested")
        self.assertEqual(screen.call_args.args[0][0].text, TEXT)
        self.assertFalse(case.extraction_failed)

    def test_source_translation_failure_is_fail_soft(self):
        cid = make_case()
        with patch("app.pipeline.extract.run", return_value=([], [], [], [], "Hindi", [])), \
             patch("app.pipeline.translate.to_english", side_effect=RuntimeError("provider down")):
            orchestrator.run(cid)
        case = load(cid)
        self.assertIsNone(case.sources[0].text_en)
        self.assertFalse(case.extraction_failed)
        self.assertEqual(case.status, "needs_review")


if __name__ == "__main__":
    unittest.main()
