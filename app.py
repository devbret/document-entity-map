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


def _containment_aliases(keys):
    by_label = defaultdict(list)
    for key in keys:
        by_label[key[1]].append(key)

    canonical = {}
    for group in by_label.values():
        token_index = defaultdict(list)
        for key in group:
            for tok in set(key[0].split()):
                token_index[tok].append(key)
        for short in sorted(group, key=lambda k: -len(k[0].split())):
            short_tokens = short[0].split()
            roots = {
                canonical.get(long, long)
                for long in token_index.get(short_tokens[0], ())
                if len(long[0].split()) > len(short_tokens)
                and _contains_tokens(short_tokens, long[0].split())
            }
            if len(roots) == 1:
                canonical[short] = roots.pop()
    return canonical


def _acronym_aliases(keys):
    by_label = defaultdict(set)
    for key in keys:
        by_label[key[1]].add(key)

    canonical = {}
    for group in by_label.values():
        expansions = defaultdict(set)
        for key in group:
            acro = _acronym_of(key[0])
            if acro:
                expansions[acro].add(key)
        for key in group:
            if " " in key[0]:
                continue
            word = re.sub(r"[^a-z0-9]", "", key[0])
            if not 2 <= len(word) <= 6:
                continue
            targets = expansions.get(word, set()) - {key}
            if len(targets) == 1:
                canonical[key] = next(iter(targets))
    return canonical


def merge_aliases(doc_keys):
    resolved = {}
    for doc_name, keys in doc_keys.items():
        canonical = _containment_aliases(keys)
        for key in keys:
            resolved[(doc_name, key)] = canonical.get(key, key)
    acronyms = _acronym_aliases(set(resolved.values()))
    return {
        doc_key: acronyms.get(canon, canon)
        for doc_key, canon in resolved.items()
    }


def merged_names(spellings, display):
    names = defaultdict(Counter)
    for spelling, count in spellings.items():
        names[spelling.lower()][spelling] += count
    merged = [
        {
            "label": forms.most_common(1)[0][0],
            "mentionCount": sum(forms.values()),
        }
        for name, forms in names.items()
        if name != display.lower()
    ]
    return sorted(merged, key=lambda m: (-m["mentionCount"], m["label"]))


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

    mentions = defaultdict(Counter)
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
            mentions[(path.name, key)][display] += 1
            seen.add(key)

        print(f"          {len(seen)} distinct entities", flush=True)

    raw_total = Counter()
    raw_docs = defaultdict(set)
    for (doc_name, key), spellings in mentions.items():
        raw_total[key] += sum(spellings.values())
        raw_docs[key].add(doc_name)

    retype = majority_types(raw_total, raw_docs)
    if retype:
        print(
            f"Consolidated {len(retype)} same-name entities under their "
            "majority type."
        )

    typed_total = Counter()
    for key, count in raw_total.items():
        typed_total[retype.get(key, key)] += count
    kept = {k for k, count in typed_total.items() if count >= MIN_MENTIONS}
    if not kept:
        raise SystemExit("No entities found in the input documents.")

    canonical = {}
    if MERGE_ALIASES:
        doc_keys = defaultdict(set)
        for doc_name, key in mentions:
            key = retype.get(key, key)
            if key in kept:
                doc_keys[doc_name].add(key)
        canonical = merge_aliases(doc_keys)

    edge = Counter()
    ent_total = Counter()
    ent_docs = defaultdict(set)
    ent_surface = defaultdict(Counter)
    type_votes = defaultdict(Counter)
    for (doc_name, raw_key), spellings in mentions.items():
        key = retype.get(raw_key, raw_key)
        if key not in kept:
            continue
        key = canonical.get((doc_name, key), key)
        count = sum(spellings.values())
        edge[(doc_name, key)] += count
        ent_total[key] += count
        ent_docs[key].add(doc_name)
        ent_surface[key].update(spellings)
        type_votes[key][raw_key[1]] += count

    if any(canon != key for (_doc, key), canon in canonical.items()):
        print(f"Merged aliases: down to {len(ent_total)} distinct entities.")
    kept = set(ent_total)

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
        node = {
            "id": ent_id(key),
            "type": "entity",
            "label": display,
            "entityType": label,
            "entityTypeLabel": NAMED_LABELS[label],
            "docCount": len(ent_docs[key]),
            "mentionCount": ent_total[key],
        }
        if len(type_votes[key]) > 1:
            node["typeVotes"] = dict(type_votes[key].most_common())
        aliases = merged_names(ent_surface[key], display)
        if aliases:
            node["aliases"] = aliases
        nodes.append(node)

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
            "typeConflicts": sum("typeVotes" in n for n in nodes),
            "mergedEntities": sum("aliases" in n for n in nodes),
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
