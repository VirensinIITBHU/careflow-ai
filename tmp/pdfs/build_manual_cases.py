import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "samples/regression/safety_regression_cases.jsonl"
OUTPUT = ROOT / "output/pdf/careflow-ai-manual-safety-test-cases.pdf"

# Static Devanagari font so the Hindi/Hinglish cases render legibly in the PDF.
DEVANAGARI_FONT = Path("/usr/share/fonts/gnu-free/FreeSans.ttf")
pdfmetrics.registerFont(TTFont("CopyText", str(DEVANAGARI_FONT)))

INK = colors.HexColor("#1B2834")
MUTED = colors.HexColor("#5C6B78")
TEAL = colors.HexColor("#087E8B")
PAPER = colors.HexColor("#F5F4F0")
LINE = colors.HexColor("#D9D8D2")
CURRENT = colors.HexColor("#A63232")
CONTEXT = colors.HexColor("#8A6100")
CLEAR = colors.HexColor("#087E8B")
WHITE = colors.white
PAGE_W, PAGE_H = A4

STYLES = {
    "body": ParagraphStyle("body", fontName="CopyText", fontSize=11.5, leading=16, textColor=INK, spaceAfter=0),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8.3, leading=11, textColor=MUTED),
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=INK),
    "deck": ParagraphStyle("deck", fontName="Helvetica", fontSize=10.5, leading=15, textColor=MUTED),
    "cover": ParagraphStyle("cover", fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK),
}


def expected_label(case):
    expect = case["expect"]
    if expect == "none":
        return "No deterministic rule flag expected", CLEAR
    kind, code = expect.split(":", 1)
    if kind == "current":
        return f"Current rule flag expected: {code}", CURRENT
    return f"Context-only flag expected: {code}", CONTEXT


class CaseCard(Flowable):
    def __init__(self, number, case, width):
        super().__init__()
        self.number, self.case, self.width = number, case, width
        self.label, self.accent = expected_label(case)
        self.text_para = Paragraph(escape(case["text"]), STYLES["body"])
        _, self.text_h = self.text_para.wrap(width - 30, 1000)
        self.height = self.text_h + 125

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        _, self.text_h = self.text_para.wrap(availWidth - 30, 1000)
        self.height = self.text_h + 125
        return self.width, self.height

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.setFillColor(WHITE)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.7)
        c.roundRect(0, 0, w, h, 9, stroke=1, fill=1)
        c.setFillColor(self.accent)
        c.roundRect(0, h - 5, w, 5, 2, stroke=0, fill=1)

        x = 14
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(x, h - 22, f"{self.number:02d}  {self.case['id']}")
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8.5)
        c.drawRightString(w - 14, h - 22, f"{self.case['lang'].upper()}  |  {self.case['expect'].split(':')[0].upper()}")

        c.setFillColor(self.accent)
        c.setFont("Helvetica-Bold", 8.4)
        c.drawString(x, h - 39, self.label)
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 7.1)
        c.drawString(x, h - 55, "COPY THIS TEXT INTO A NEW SYNTHETIC CASE")
        self.text_para.drawOn(c, x, h - 62 - self.text_h)

        bottom = h - 70 - self.text_h
        c.setStrokeColor(LINE)
        c.line(x, bottom, w - x, bottom)
        c.setFillColor(INK)
        c.setFont("Helvetica", 8)
        c.drawString(x, bottom - 14, "App result:  [ ] matches  [ ] missing expected flag  [ ] extra flag(s)")
        c.setFillColor(MUTED)
        c.drawString(x, bottom - 28, "Actual flag(s): __________________________________________________")


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(INK)
    canvas.rect(0, PAGE_H - 11, PAGE_W, 11, stroke=0, fill=1)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(doc.leftMargin, 32, PAGE_W - doc.rightMargin, 32)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 19, "CareFlow AI  |  Synthetic rule-screen regression only  |  Not clinical guidance")
    canvas.drawRightString(PAGE_W - doc.rightMargin, 19, f"Page {doc.page}")
    canvas.restoreState()


cases = [json.loads(line) for line in SOURCE.read_text(encoding="utf-8").splitlines() if line.strip()]
if len(cases) < 30:
    raise SystemExit(f"Need at least 30 cases; found {len(cases)}")

story = [
    Spacer(1, 12),
    Paragraph("Manual Safety Regression Cases", STYLES["title"]),
    Spacer(1, 5),
    Paragraph(f"{len(cases)} copy-paste test inputs for the CareFlow AI demo", STYLES["deck"]),
    Spacer(1, 12),
    Paragraph("HOW TO RUN", ParagraphStyle("how", fontName="Helvetica-Bold", fontSize=9, textColor=TEAL, leading=12)),
    Spacer(1, 4),
    Paragraph("For each case, create a fresh synthetic/demo case in the app and paste only the text shown in its card. Compare the app's deterministic rule-screen result with the expected result, then record the actual flags. Keep each case separate so one input cannot affect another.", STYLES["cover"]),
    Spacer(1, 7),
    Paragraph("HOW TO READ THE TARGET", ParagraphStyle("target", fontName="Helvetica-Bold", fontSize=9, textColor=TEAL, leading=12)),
    Spacer(1, 4),
    Paragraph("CURRENT means the rule screen should add the listed category. CONTEXT means it should show a context/uncertain flag and not treat that category as current. NONE means no deterministic policy flag is expected. These are expected software outputs for this test set, not clinical judgments. The optional model reader or extraction may add extra flags; note those separately.", STYLES["cover"]),
    Spacer(1, 7),
    Paragraph("SYNTHETIC DATA ONLY. Do not enter real patient information. Rules are unvalidated and this sheet does not establish clinical accuracy.", ParagraphStyle("warn", fontName="Helvetica-Bold", fontSize=8.5, leading=12, textColor=CURRENT)),
    Spacer(1, 12),
    Paragraph("Test log", ParagraphStyle("log", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=INK)),
    Spacer(1, 4),
]

# Keep the case cards in simple reading order; their dynamic height allows multilingual
# text to wrap without shrinking or clipping. The intro shares page 1 with the first cases.
for idx, case in enumerate(cases, 1):
    story.append(CaseCard(idx, case, PAGE_W - 2 * 42))
    story.append(Spacer(1, 10))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=A4, rightMargin=42, leftMargin=42, topMargin=28, bottomMargin=42,
    title="CareFlow AI Manual Safety Regression Cases",
    author="CareFlow AI project team",
    subject="Synthetic manual software test cases; not clinical guidance",
)
doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
print(f"created {OUTPUT} with {len(cases)} test cases")
