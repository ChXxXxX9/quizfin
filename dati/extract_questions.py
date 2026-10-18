"""Estrae le domande e il correttore dai PDF forniti.
Uso: python extract_questions.py
Genera questions.js, questions.json e validation_report.json.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent
QUESTIONS_PDF = ROOT.parent / "2024_11_16 1000 Domande.pdf"
ANSWERS_PDF = ROOT.parent / "2024_11_16 Correttore.pdf"
OUT_JS = ROOT / "questions.js"
OUT_JSON = ROOT / "questions.json"
REPORT_JSON = ROOT / "validation_report.json"

TOPIC_FIXES = {
    "Biofiosiologia": "Biofisiologia",
    "La cutura": "La cultura",
}

LETTERS = ["A", "B", "C", "D"]
OPTION_RE = re.compile(r"^\[\s*([A-D])\s*\]\s*(.*)$")


def clean_join(parts: list[str]) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip()).strip()


def extract_question_lines(pdf_path: Path) -> list[str]:
    lines: list[str] = []
    with fitz.open(pdf_path) as doc:
        for page_number, page in enumerate(doc, start=1):
            seen_page_content = False
            skipped_page_number = False
            for raw in page.get_text("text").splitlines():
                line = raw.strip()
                if not line:
                    continue
                if line.startswith("ISTRUTTORE DI NUOTO"):
                    continue
                if line.startswith("FEDERAZIONE ITALIANA NUOTO"):
                    continue
                # Ogni pagina contiene il numero pagina subito dopo l'intestazione.
                # Lo eliminiamo solo in quella posizione, per non eliminare opzioni numeriche legittime.
                if not skipped_page_number and not seen_page_content and line == str(page_number):
                    skipped_page_number = True
                    continue
                seen_page_content = True
                lines.append(line)
    return lines


def find_question_starts(lines: list[str]) -> list[int]:
    starts: list[int] = []
    expected = 1
    i = 0
    while i < len(lines) and expected <= 1000:
        if lines[i] == str(expected):
            next_line = lines[i + 1] if i + 1 < len(lines) else ""
            if next_line and not next_line.startswith("[") and not re.fullmatch(r"\d+", next_line):
                starts.append(i)
                expected += 1
                i += 1
                continue
        i += 1
    return starts


def parse_questions(pdf_path: Path) -> list[dict]:
    lines = extract_question_lines(pdf_path)
    starts = find_question_starts(lines)
    if len(starts) != 1000:
        raise RuntimeError(f"Domande trovate: {len(starts)}, attese: 1000")

    questions: list[dict] = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        qid = int(lines[start])
        raw_topic = lines[start + 1]
        topic = TOPIC_FIXES.get(raw_topic, raw_topic)
        body = lines[start + 2 : end]

        option_positions = [i for i, line in enumerate(body) if OPTION_RE.match(line)]
        if len(option_positions) not in (3, 4):
            raise RuntimeError(f"Domanda {qid}: opzioni riconosciute {len(option_positions)}")

        question_text = clean_join(body[: option_positions[0]])
        options: list[str] = []
        labels: list[str] = []
        for opt_index, pos in enumerate(option_positions):
            match = OPTION_RE.match(body[pos])
            assert match is not None
            label = match.group(1)
            first_text = match.group(2).strip()
            next_pos = option_positions[opt_index + 1] if opt_index + 1 < len(option_positions) else len(body)
            option_text = clean_join([first_text] + body[pos + 1 : next_pos])
            labels.append(label)
            options.append(option_text)

        # Correzioni di estrazione per anomalie visibili nel PDF originale.
        # Non viene modificato il testo: viene solo recuperata l'opzione non marcata dal layout.
        if qid == 833:
            # Nel PDF l'ultima alternativa non ha il marcatore [D].
            merged = options[2]
            split_token = " Apprendimento motorio generale, analitico motorio e segmentario"
            if split_token in merged:
                options[2] = merged.replace(split_token, "").strip()
                options.append(split_token.strip())
                labels = ["A", "B", "C", "D"]
        if qid == 964:
            # Nel PDF la frase "Un forte desiderio di soffrire" è non marcata nella colonna risposte.
            stray = "Un forte desiderio di soffrire"
            if question_text.endswith(stray):
                question_text = question_text[: -len(stray)].strip()
                options.append(stray)
                labels = ["A", "B", "C", "D"]

        questions.append(
            {
                "id": qid,
                "topic": topic,
                "rawTopic": raw_topic,
                "question": question_text,
                "options": options,
                "labels": LETTERS[: len(options)],
            }
        )
    return questions


def parse_answers(pdf_path: Path) -> dict[int, str]:
    answers: dict[int, str] = {}
    with fitz.open(pdf_path) as doc:
        for page in doc:
            text = page.get_text("text")
            for number, answer in re.findall(r"\b(\d{1,4})\s*\n\s*([A-D])\b", text):
                qid = int(number)
                if 1 <= qid <= 1000:
                    answers[qid] = answer
    return answers


def main() -> None:
    questions = parse_questions(QUESTIONS_PDF)
    answers = parse_answers(ANSWERS_PDF)
    if len(answers) != 1000:
        raise RuntimeError(f"Risposte trovate: {len(answers)}, attese: 1000")

    letter_to_index = {letter: i for i, letter in enumerate(LETTERS)}
    for q in questions:
        qid = q["id"]
        letter = answers[qid]
        index = letter_to_index[letter]
        if index >= len(q["options"]):
            raise RuntimeError(f"Domanda {qid}: risposta {letter} fuori dal range opzioni")
        q["correctLetter"] = letter
        q["correctIndex"] = index

    topics = Counter(q["topic"] for q in questions)
    option_counts = Counter(len(q["options"]) for q in questions)
    report = {
        "questions": len(questions),
        "answers": len(answers),
        "topics": dict(sorted(topics.items())),
        "optionCounts": dict(sorted(option_counts.items())),
        "missingQuestionIds": [i for i in range(1, 1001) if i not in {q["id"] for q in questions}],
        "missingAnswerIds": [i for i in range(1, 1001) if i not in answers],
        "manualLayoutFixes": [833, 964],
    }

    data_json = json.dumps(questions, ensure_ascii=False, indent=2)
    OUT_JSON.write_text(data_json + "\n", encoding="utf-8")
    OUT_JS.write_text(
        "// Generato automaticamente da extract_questions.py.\n"
        "// Non modificare a mano: rigenera dal PDF se cambia la banca dati.\n"
        "window.QUIZ_QUESTIONS = " + data_json + ";\n",
        encoding="utf-8",
    )
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
