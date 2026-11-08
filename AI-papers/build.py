"""Build the public paper library and check its HTML before publishing."""
import argparse
import html
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
        self.slides = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "section" and "slide" in attrs.get("class", "").split():
            self.slides += 1
        for name in ("href", "src", "action", "poster"):
            if attrs.get(name):
                self.urls.append(attrs[name])


def check_url(url, context):
    decoded = unquote(html.unescape(url)).strip()
    parsed = urlsplit(decoded)
    host = (parsed.hostname or "").lower()
    if parsed.scheme in {"file", "javascript", "codex", "plugin"} or decoded.startswith("\\\\"):
        raise ValueError(f"Non-public URL in {context}: {url}")
    if host in {"localhost", "wsl.localhost"} or host.endswith((".localhost", ".local", ".internal", ".chatgpt.site")):
        raise ValueError(f"Internal host in {context}: {host}")
    if host:
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            if not address.is_global:
                raise ValueError(f"Private address in {context}: {host}")


def validate(papers):
    slugs = set()
    for paper in papers:
        slug = paper["slug"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in slugs:
            raise ValueError(f"Invalid or duplicate slug: {slug}")
        slugs.add(slug)
        check_url(paper["paper_url"], slug)
        path = ROOT / slug / "index.html"
        parser = Links()
        parser.feed(path.read_text(encoding="utf-8"))
        if parser.slides != paper["slides"]:
            raise ValueError(f"{slug}: declared {paper['slides']} slides, found {parser.slides}")
    for path in ROOT.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        parser = Links()
        parser.feed(text)
        for url in parser.urls:
            check_url(url, path.relative_to(ROOT))
            parsed = urlsplit(url)
            if not parsed.scheme and not parsed.netloc and parsed.path:
                target = path.parent / unquote(parsed.path)
                if not target.exists():
                    raise ValueError(f"Broken relative link in {path.name}: {url}")
        for url in re.findall(r"(?:https?://|file://)[^\s<>\"']+", text):
            check_url(url, path.relative_to(ROOT))
        for marker in ("wsl.localhost", "127.0.0.1", "localhost:", "chatgpt.site", "C:/Users/", "C:\\Users\\", "/home/hrant/"):
            if marker.lower() in text.lower():
                raise ValueError(f"Local or internal reference in {path.relative_to(ROOT)}: {marker}")


def build(papers):
    e = lambda value: html.escape(str(value), quote=True)
    cards = []
    for paper in papers:
        search = " ".join([paper["title"], paper["short_title"], paper["venue"], *paper["topics"], paper["summary"]])
        note = f'<p class="note">{e(paper["note"])}</p>' if paper.get("note") else ""
        cards.append(f'''<article class="paper" data-search="{e(search.lower())}">
<div class="meta">{e(paper['venue'])} · {e(paper['slides'])} slides</div>
<h2><a href="{e(paper['slug'])}/">{e(paper['short_title'])}</a></h2>
<p class="full-title">{e(paper['title'])}</p><p>{e(paper['summary'])}</p>{note}
<div class="links"><a href="{e(paper['slug'])}/">Open presentation →</a><a href="{e(paper['paper_url'])}">Original paper ↗</a></div>
<p class="topics">{' · '.join(e(topic) for topic in paper['topics'])}</p></article>''')
    template = (ROOT / "index.template.html").read_text(encoding="utf-8")
    (ROOT / "index.html").write_text(template.replace("<!-- PAPER_CARDS -->", "\n".join(cards)).replace("{{COUNT}}", str(len(papers))), encoding="utf-8")


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--check", action="store_true", help="Validate without rebuilding")
    options = args.parse_args()
    records = json.loads((ROOT / "papers.json").read_text(encoding="utf-8"))
    if not options.check:
        build(records)
    validate(records)
    print(f"Validated {len(records)} presentations, slide counts, local links, and public URL references.")
