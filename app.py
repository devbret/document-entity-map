from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import json
import re

import spacy

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")
JSON_FILE = OUTPUT_DIR / "graph.json"

PREFERRED_MODELS = (
    "en_core_web_trf",
    "en_core_web_lg",
    "en_core_web_md",
    "en_core_web_sm",
)

MIN_MENTIONS = 1

MERGE_ALIASES = True

CHUNK_CHARS = 100_000

NOISE_TERMS = {
    "al", "al.", "et al", "et al.", "ibid", "ibid.", "pp", "pp.",
    "e.g", "e.g.", "i.e", "i.e.", "etc", "etc.", "vol", "vol.",
    "n.d.", "op. cit.",
}

DROP_TERMS = {
    "ai", "a.i.", "ml", "genai", "gen ai", "gen-ai", "llm", "llms",
    "iot", "stem", "dei",
}

NAMED_LABELS = {
    "PERSON": "People, including fictional",
    "NORP": "Nationalities, religious or political groups",
    "FAC": "Buildings, airports, highways, bridges, etc.",
    "ORG": "Companies, agencies, institutions",
    "GPE": "Countries, cities, states",
    "LOC": "Non-GPE locations: mountains, bodies of water",
    "PRODUCT": "Objects, vehicles, foods, etc. (not services)",
    "EVENT": "Named hurricanes, battles, wars, sports events",
    "WORK_OF_ART": "Titles of books, songs, etc.",
    "LAW": "Named documents made into laws",
    "LANGUAGE": "Any named language",
}


def read_pdf(path):
    import fitz

    flags = fitz.TEXTFLAGS_TEXT | fitz.TEXT_DEHYPHENATE
    pages = []
    with fitz.open(path) as doc:
        for page in doc:
            pages.append(page.get_text("text", flags=flags))

    if len(pages) >= 4:
        line_pages = Counter()
        for page in pages:
            for line in {ln.strip() for ln in page.splitlines()}:
                if line:
                    line_pages[line] += 1
        cutoff = max(3, int(len(pages) * 0.6))
        boiler = {ln for ln, n in line_pages.items() if n >= cutoff}
        if boiler:
            pages = [
                "\n".join(
                    ln for ln in page.splitlines() if ln.strip() not in boiler
                )
                for page in pages
            ]
    return "\n".join(pages)


def _iter_shapes(shapes):
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _iter_shapes(shape.shapes)
        else:
            yield shape


def read_pptx(path):
    from pptx import Presentation

    parts = []
    prs = Presentation(path)
    for slide in prs.slides:
        for shape in _iter_shapes(slide.shapes):
            if shape.has_text_frame and shape.text_frame.text.strip():
                parts.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            parts.append(cell.text)
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text
            if notes.strip():
                parts.append(notes)
    return "\n".join(parts)


def read_txt(path):
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1")


READERS = {
    ".pdf": (read_pdf, "pdf"),
    ".pptx": (read_pptx, "pptx"),
    ".txt": (read_txt, "txt"),
}


def normalize(text):
    return " ".join(text.split())


SPACED_LETTERS = re.compile(r"\b(?:[A-Za-z] ){2,}[A-Za-z]\b")


def preclean(text):
    return SPACED_LETTERS.sub(lambda m: m.group().replace(" ", ""), text)


TRIM_CHARS = " \t\"'“”‘’`•·◦▪*∙\u2013\u2014\u2010\u2011,;:!?/\\|<>"
LAYOUT_REF = re.compile(
    r"^(figure|figures|fig|table|tables|chapter|section|page|box|annex|"
    r"appendix|exhibit)\s+\S+$"
)


def clean_entity(name):
    name = name.strip(TRIM_CHARS)
    if name.startswith("(") and name.endswith(")"):
        name = name[1:-1].strip(TRIM_CHARS)
    for suffix in ("'s", "’s"):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)].rstrip()
    first, _, rest = name.partition(" ")
    if first.lower() in ("the", "a", "an") and rest:
        name = rest.strip(TRIM_CHARS)
    low = name.lower()
    if len(re.sub(r"[^a-z0-9]", "", low)) < 2:
        return None
    if not re.search(r"[a-z]", low):
        return None
    if low in NOISE_TERMS or low in DROP_TERMS:
        return None
    if "http" in low or "www." in low or "@" in low:
        return None
    if LAYOUT_REF.match(low):
        return None
    return name


def chunks(text, size):
    if len(text) <= size:
        yield text
        return
    start, n = 0, len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            split = text.rfind("\n", start, end)
            if split > start:
                end = split
        yield text[start:end]
        start = end


def entities_in(text, nlp):
    size = min(CHUNK_CHARS, nlp.max_length - 1)
    for doc in nlp.pipe(chunks(text, size)):
        for ent in doc.ents:
            if ent.label_ not in NAMED_LABELS:
                continue
            name = clean_entity(normalize(ent.text))
            if not name:
                continue
            yield name, (name.lower(), ent.label_), ent.label_


def _contains_tokens(short, long):
    n = len(short)
    return any(long[i:i + n] == short for i in range(len(long) - n + 1))


ACRO_STOP = {"of", "the", "and", "for", "in", "on", "at", "to", "&"}


def _acronym_of(name):
    tokens = [t for t in re.split(r"[\s\-]+", name) if t and t not in ACRO_STOP]
    if len(tokens) < 2:
        return None
    return "".join(t[0] for t in tokens)


def merge_aliases(kept, ent_total):
    by_label = defaultdict(list)
    for key in kept:
        by_label[key[1]].append(key)

    canonical = {key: key for key in kept}
    for keys in by_label.values():
        token_index = defaultdict(list)
        for key in keys:
            for tok in set(key[0].split()):
                token_index[tok].append(key)
        for short in keys:
            short_tokens = short[0].split()
            best, best_total = None, -1
            for long in token_index.get(short_tokens[0], ()):
                long_tokens = long[0].split()
                if len(long_tokens) <= len(short_tokens):
                    continue
                if _contains_tokens(short_tokens, long_tokens) and (
                    ent_total[long] > best_total
                ):
                    best, best_total = long, ent_total[long]
            if best is not None:
                canonical[short] = best

    def resolve(key):
        while canonical[key] != key:
            key = canonical[key]
        return key

    resolved = {key: resolve(key) for key in kept}

    by_label_canon = defaultdict(set)
    for canon in set(resolved.values()):
        by_label_canon[canon[1]].add(canon)
    acro_target = {}
    for canons in by_label_canon.values():
        expansions = defaultdict(set)
        for canon in canons:
            acro = _acronym_of(canon[0])
            if acro:
                expansions[acro].add(canon)
        for canon in canons:
            if " " in canon[0]:
                continue
            word = re.sub(r"[^a-z0-9]", "", canon[0])
            if not 2 <= len(word) <= 6:
                continue
            targets = expansions.get(word, set()) - {canon}
            if len(targets) == 1:
                acro_target[canon] = next(iter(targets))
    if acro_target:
        return {
            key: acro_target.get(canon, canon)
            for key, canon in resolved.items()
        }
    return resolved


def apply_mapping(mapping, edge, ent_total, ent_docs, ent_surface):
    new_edge = Counter()
    for (doc_name, key), count in edge.items():
        new_edge[(doc_name, mapping.get(key, key))] += count
    new_total = Counter()
    new_docs = defaultdict(set)
    new_surface = defaultdict(Counter)
    for key, total in ent_total.items():
        canon = mapping.get(key, key)
        new_total[canon] += total
        new_docs[canon] |= ent_docs[key]
        new_surface[canon].update(ent_surface[key])
    return new_edge, new_total, new_docs, new_surface


def majority_types(ent_total, ent_docs):
    by_name = defaultdict(list)
    for key in ent_total:
        by_name[key[0]].append(key)
    mapping = {}
    for keys in by_name.values():
        if len(keys) < 2:
            continue
        winner = max(
            keys, key=lambda k: (ent_total[k], len(ent_docs[k]), k[1])
        )
        for key in keys:
            if key != winner:
                mapping[key] = winner
    return mapping


def main():
    files = sorted(
        p for p in INPUT_DIR.glob("*") if p.suffix.lower() in READERS
    )
    skipped = sorted(
        p.name for p in INPUT_DIR.glob("*")
        if p.is_file() and p.suffix.lower() not in READERS
    )
    if skipped:
        print(f"Skipping unsupported file(s): {', '.join(skipped)}")
        if any(name.lower().endswith(".ppt") for name in skipped):
            print(
                "  Legacy .ppt (binary PowerPoint) can't be read; "
                "convert it to .pptx first."
            )
    if not files:
        raise SystemExit(
            f"No .pdf, .pptx or .txt files found in {INPUT_DIR}/"
        )

    nlp = None
    for model in PREFERRED_MODELS:
        try:
            nlp = spacy.load(model)
            break
        except OSError:
            continue
    if nlp is None:
        raise SystemExit(
            "No spaCy English model is installed. Install one with:\n"
            "    pip install -r requirements.txt\n"
            f"or: python -m spacy download {PREFERRED_MODELS[-1]}"
        )
    nlp.select_pipes(enable=["transformer", "curated_transformer", "tok2vec", "ner"])
    print(f"Using spaCy model {model}.")
    if model == "en_core_web_sm":
        print(
            "  Tip: en_core_web_lg or en_core_web_trf gives noticeably more "
            "accurate entities\n"
            "  (python -m spacy download en_core_web_lg) - app.py picks the "
            "best installed model."
        )

    edge = Counter()
    ent_total = Counter()
    ent_docs = defaultdict(set)
    ent_surface = defaultdict(Counter)
    doc_formats = {}

    total = len(files)
    for i, path in enumerate(files, 1):
        reader, fmt = READERS[path.suffix.lower()]
        doc_formats[path.name] = fmt
        print(f"[{i}/{total}] {path.name}", flush=True)
        try:
            text = preclean(reader(path))
        except Exception as exc:
            print(f"          ! could not read: {exc}", flush=True)
            continue

        seen = set()
        for display, key, _label in entities_in(text, nlp):
            edge[(path.name, key)] += 1
            ent_total[key] += 1
            ent_docs[key].add(path.name)
            ent_surface[key][display] += 1
            seen.add(key)

        print(f"          {len(seen)} distinct entities", flush=True)

    remap = majority_types(ent_total, ent_docs)
    if remap:
        edge, ent_total, ent_docs, ent_surface = apply_mapping(
            remap, edge, ent_total, ent_docs, ent_surface
        )
        print(
            f"Consolidated {len(remap)} same-name entities under their "
            "majority type."
        )

    kept = {k for k, count in ent_total.items() if count >= MIN_MENTIONS}
    if not kept:
        raise SystemExit("No entities found in the input documents.")

    if MERGE_ALIASES:
        alias = {
            k: v for k, v in merge_aliases(kept, ent_total).items() if v != k
        }
        if alias:
            edge, ent_total, ent_docs, ent_surface = apply_mapping(
                alias, edge, ent_total, ent_docs, ent_surface
            )
            kept = {alias.get(k, k) for k in kept}
            print(f"Merged aliases: down to {len(kept)} distinct entities.")

    nodes = []

    doc_mentions = Counter()
    doc_distinct = Counter()
    for (doc_name, key), count in edge.items():
        if key in kept:
            doc_mentions[doc_name] += count
            doc_distinct[doc_name] += 1
    for name in sorted(doc_mentions):
        nodes.append({
            "id": f"doc::{name}",
            "type": "document",
            "label": name,
            "format": doc_formats[name],
            "entityCount": doc_distinct[name],
            "mentionCount": doc_mentions[name],
        })

    def ent_id(key):
        name_lc, label = key
        return f"ent::{label}::{name_lc}"

    for key in sorted(kept, key=lambda k: (-ent_total[k], k)):
        _name_lc, label = key
        display = ent_surface[key].most_common(1)[0][0]
        nodes.append({
            "id": ent_id(key),
            "type": "entity",
            "label": display,
            "entityType": label,
            "entityTypeLabel": NAMED_LABELS[label],
            "docCount": len(ent_docs[key]),
            "mentionCount": ent_total[key],
        })

    links = []
    for (doc_name, key), count in sorted(edge.items()):
        if key not in kept:
            continue
        links.append({
            "source": f"doc::{doc_name}",
            "target": ent_id(key),
            "value": count,
        })

    graph = {
        "meta": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "documents": len(doc_mentions),
            "entities": len(kept),
            "links": len(links),
            "entityTypes": NAMED_LABELS,
        },
        "nodes": nodes,
        "links": links,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    JSON_FILE.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    print(
        f"\nWrote {len(nodes)} nodes "
        f"({len(doc_mentions)} documents, {len(kept)} entities) "
        f"and {len(links)} links."
    )
    print(f"  data: {JSON_FILE}")
    print(
        "  View it by serving the repo root over http (e.g. VS Code Live "
        f"Server) and opening index.html; it fetches {JSON_FILE} at runtime."
    )


if __name__ == "__main__":
    main()
