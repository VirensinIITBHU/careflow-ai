"""Small, deterministic vocabulary for the live interview copilot: language detection, a lexicon of common
non-urgent symptoms (warning signs come from the safety policy instead), detail-slot patterns, and question
templates in English, Hinglish (romanized Hindi) and Hindi (Devanagari).

These templates only gather information. They never suggest a diagnosis, a treatment or a level of urgency."""
import re

LANGS = ("en", "hinglish", "hi")

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_ARABIC = re.compile(r"[؀-ۿ]")
_HINGLISH_MARKERS = re.compile(
    r"\b(hai|hain|mujhe|mera|meri|mere|nahi|nahin|nhi|mein|bahut|kal|aaj|se|ho|raha|rahi|rahe|tha|thi|aur|"
    r"dard|bukhar|saans|lag|kuch|bhi|abhi|subah|raat|din|kya|kab)\b", re.I)


def detect_language(text: str, hint: str | None = None) -> str:
    """Returns 'hi', 'hinglish' or 'en'. Urdu script is shown with Hinglish questions (spoken Hindustani is
    shared); the English question is always shown alongside."""
    h = (hint or "").strip().lower()
    if h in ("hi", "hindi"):
        return "hi"
    if h in ("hinglish", "hindi-english"):
        return "hinglish"
    t = text or ""
    if _DEVANAGARI.search(t):
        return "hi"
    if _ARABIC.search(t):
        return "hinglish"
    if len(_HINGLISH_MARKERS.findall(t)) >= 2:
        return "hinglish"
    if h in ("en", "english"):
        return "en"
    return "en"


# id -> display names per language, and lowercase match patterns (regex fragments).
SYMPTOMS: dict[str, dict] = {
    "fever": {"en": "fever", "hinglish": "bukhar", "hi": "बुखार",
              "p": [r"fever", r"temperature", r"bukh?aa?r", r"बुखार", r"ताप"]},
    "cough": {"en": "cough", "hinglish": "khansi", "hi": "खांसी",
              "p": [r"cough\w*", r"khaa?nsi", r"खांसी", r"खाँसी"]},
    "headache": {"en": "headache", "hinglish": "sir dard", "hi": "सिरदर्द",
                 "p": [r"headache", r"head ?ache", r"head pain", r"s[ia]r ?dard", r"सिर ?दर्द", r"सर ?दर्द"]},
    "vomiting": {"en": "vomiting", "hinglish": "ulti", "hi": "उल्टी",
                 "p": [r"vomit\w*", r"throwing up", r"ulti", r"उल्टी", r"nausea", r"ji machal"]},
    "diarrhoea": {"en": "loose motions", "hinglish": "dast", "hi": "दस्त",
                  "p": [r"diarrh?o?ea", r"loose motions?", r"dast", r"दस्त"]},
    "abdominal_pain": {"en": "stomach pain", "hinglish": "pet dard", "hi": "पेट दर्द",
                       "p": [r"stomach (pain|ache)", r"abdominal pain", r"tummy (pain|ache)", r"belly pain",
                             r"pet (mein |me )?dard", r"पेट (में )?दर्द"]},
    "sore_throat": {"en": "sore throat", "hinglish": "gale mein dard", "hi": "गले में दर्द",
                    "p": [r"sore throat", r"throat pain", r"gale? (mein |me )?(dard|khara?sh)", r"gala kharab",
                          r"गले में (दर्द|खराश)"]},
    "body_ache": {"en": "body ache", "hinglish": "badan dard", "hi": "बदन दर्द",
                  "p": [r"body ?(ache|pain)s?", r"aches", r"badan dard", r"bad[ae]n (mein )?dard", r"बदन दर्द",
                        r"शरीर (में )?दर्द"]},
    "fatigue": {"en": "tiredness", "hinglish": "thakaan", "hi": "थकान",
                "p": [r"tired\w*", r"fatigue", r"weakness", r"thak[aā]a?n", r"kamzori", r"थकान", r"कमज़?जोरी"]},
    "dizziness": {"en": "dizziness", "hinglish": "chakkar", "hi": "चक्कर",
                  "p": [r"dizz\w*", r"light[- ]headed", r"chakk?ar", r"चक्कर"]},
    "rash": {"en": "rash", "hinglish": "daane", "hi": "दाने",
             "p": [r"rash\w*", r"daane", r"chakatt?e", r"दाने", r"चकत्ते"]},
    "cold": {"en": "runny nose", "hinglish": "naak behna", "hi": "नाक बहना",
             "p": [r"runny nose", r"blocked nose", r"sneez\w*", r"naak beh\w*", r"zukaam", r"jukam", r"नाक बह", r"जुकाम"]},
    "back_pain": {"en": "back pain", "hinglish": "kamar dard", "hi": "कमर दर्द",
                  "p": [r"back ?(pain|ache)", r"kamar (mein )?dard", r"कमर (में )?दर्द"]},
    "joint_pain": {"en": "joint pain", "hinglish": "jodon mein dard", "hi": "जोड़ों में दर्द",
                   "p": [r"joint pains?", r"jodo?n? (mein )?dard", r"जोड़ों (में )?दर्द"]},
}

# Short names for safety-policy categories, used when a warning sign is detected in the conversation.
WARNING_NAMES = {
    "breathing_difficulty": {"en": "breathing difficulty", "hinglish": "saans ki takleef", "hi": "सांस की तकलीफ"},
    "chest_pain": {"en": "chest pain", "hinglish": "seene mein dard", "hi": "सीने में दर्द"},
    "loss_of_consciousness": {"en": "fainting", "hinglish": "behoshi", "hi": "बेहोशी"},
    "stroke_signs": {"en": "weakness or speech change", "hinglish": "kamzori ya bolne mein dikkat",
                     "hi": "कमज़ोरी या बोलने में दिक्कत"},
    "severe_bleeding": {"en": "heavy bleeding", "hinglish": "bahut khoon behna", "hi": "बहुत खून बहना"},
    "seizure": {"en": "fits or seizure", "hinglish": "daura", "hi": "दौरा"},
    "self_harm": {"en": "thoughts of self-harm", "hinglish": "khud ko nuksan ke vichar",
                  "hi": "खुद को नुकसान पहुँचाने के विचार"},
    "confusion": {"en": "confusion", "hinglish": "uljhan", "hi": "भ्रम"},
    "poisoning_overdose": {"en": "poisoning or overdose", "hinglish": "zeher ya zyada dawa",
                           "hi": "ज़हर या ज़्यादा दवा"},
    "anaphylaxis": {"en": "swelling or allergic reaction", "hinglish": "soojan ya allergy",
                    "hi": "सूजन या एलर्जी"},
    "head_injury": {"en": "head injury", "hinglish": "sir mein chot", "hi": "सिर में चोट"},
    "blood_in_vomit_or_stool": {"en": "blood in vomit, stool or urine", "hinglish": "ulti ya potty mein khoon",
                                "hi": "उल्टी या मल में खून"},
    "severe_pain": {"en": "severe pain", "hinglish": "bahut tez dard", "hi": "बहुत तेज़ दर्द"},
}

# Detail slots looked for in the sentence that mentions a symptom.
SLOT_PATTERNS = {
    "onset": re.compile(
        r"\b(since|for (the )?(last|past)?\s*(a|an|one|two|three|four|five|six|seven|few|several|\d+)\s*"
        r"(minutes?|hours?|days?|weeks?|months?|years?)|\d+\s*(minutes?|hours?|days?|weeks?|months?)|ago|"
        r"yesterday|today|tonight|this (morning|evening|afternoon|week)|last (night|week|month)|"
        r"(kal|aaj|parso|subah|raat|shaam|\d+|ek|do|teen|char|chaar|paanch|kuch) ?(din|hafte|haftey|mahine|ghante|"
        r"saal)?\s*(se|pehle)|kal|aaj|subah)\b|"
        r"(कल|आज|सुबह|रात|परसों|\d+|एक|दो|तीन|चार|पांच|कुछ)\s*(दिन|हफ्ते|महीने|घंटे|साल)?\s*(से|पहले)", re.I),
    "severity": re.compile(
        r"\b(mild|moderate|severe|very|extreme\w*|a lot|terrible|unbearable|slight\w*|little|bad|worst|"
        r"\d+\s*(/|out of)\s*10|bahut|zyada|jyada|tez|halk[aie]|thoda|thodi|kam)\b|बहुत|तेज़?|हल्का|हल्की|थोड़ा|थोड़ी|"
        r"ज़्यादा|ज्यादा", re.I),
    "course": re.compile(
        r"\b(worse|worsening|getting (worse|better)|better|improv\w*|same|increas\w*|decreas\w*|badh\w*|"
        r"kam ho\w*|waisa hi|ghat\w*)\b|बढ़|कम हो|वैसा ही|घट", re.I),
}

GENERIC_PATTERNS = {
    "age": re.compile(r"\b\d{1,3}\s*(-| )?(years?|yrs?|y/?o|saal|sal)( old)?\b|\bage[ds]?\b|\bumr\b|\bumar\b|उम्र|"
                      r"\d{1,3}\s*(साल|वर्ष)", re.I),
    "medications": re.compile(r"\b(medicines?|medications?|tablets?|pills?|taking|dawa\w*|goli|syrup|paracetamol|"
                              r"crocin|dolo|insulin|inhaler)\b|दवा|दवाई|गोली", re.I),
    "allergies": re.compile(r"allerg\w*|एलर्जी", re.I),
    "conditions": re.compile(r"\b(diabet\w*|sugar|bp|blood pressure|hypertension|asthma|heart|thyroid|pregnan\w*|"
                             r"kidney|tb|tuberculosis|no other (illness|condition|disease)s?|koi bimari)\b|शुगर|बीपी|"
                             r"दमा|बीमारी", re.I),
}

T = {
    "opener": {
        "en": "What is the main problem that brought you here today?",
        "hinglish": "Aaj aap kis takleef ke liye aaye hain?",
        "hi": "आज आप किस तकलीफ़ के लिए आए हैं?",
        "reason": "Let the patient describe it in their own words.",
    },
    "onset": {
        "en": "When did the {s} start?",
        "hinglish": "{s} kab se hai?",
        "hi": "{s} कब से है?",
        "reason": "Start time not mentioned.",
    },
    "severity": {
        "en": "How bad is the {s}: mild, moderate or severe?",
        "hinglish": "{s} kitna zyada hai: halka, theek-thaak ya bahut tez?",
        "hi": "{s} कितना है: हल्का, मध्यम या बहुत तेज़?",
        "reason": "Severity not mentioned.",
    },
    "course": {
        "en": "Is the {s} getting better, getting worse, or staying the same?",
        "hinglish": "{s} badh raha hai, kam ho raha hai, ya waisa hi hai?",
        "hi": "{s} बढ़ रहा है, कम हो रहा है, या वैसा ही है?",
        "reason": "Not mentioned whether it is changing.",
    },
    "age": {
        "en": "How old is the patient?",
        "hinglish": "Patient ki umar kitni hai?",
        "hi": "मरीज़ की उम्र कितनी है?",
        "reason": "Age not recorded.",
    },
    "medications": {
        "en": "Are you taking any medicines at the moment?",
        "hinglish": "Kya aap abhi koi dawai le rahe hain?",
        "hi": "क्या आप अभी कोई दवा ले रहे हैं?",
        "reason": "Medicines not asked yet.",
    },
    "allergies": {
        "en": "Do you have any allergies to medicines or food?",
        "hinglish": "Kya aapko kisi dawai ya khane se allergy hai?",
        "hi": "क्या आपको किसी दवा या खाने से एलर्जी है?",
        "reason": "Allergies not asked yet.",
    },
    "conditions": {
        "en": "Do you have any long-term illness, such as diabetes, blood pressure or asthma?",
        "hinglish": "Kya aapko koi purani bimari hai, jaise sugar, BP ya dama?",
        "hi": "क्या आपको कोई पुरानी बीमारी है, जैसे शुगर, बीपी या दमा?",
        "reason": "Other illnesses not asked yet.",
    },
}

GENERIC_ORDER = ("age", "medications", "allergies", "conditions")


def symptom_regex(sid: str) -> re.Pattern:
    pats = SYMPTOMS[sid]["p"]
    return re.compile(r"(?<![\wऀ-ॿ])(" + "|".join(pats) + r")(?![\wऀ-ॿ])", re.I)


SYMPTOM_RE = {sid: symptom_regex(sid) for sid in SYMPTOMS}
