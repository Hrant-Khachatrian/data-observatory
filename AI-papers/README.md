# AI paper presentations

Public collection: <https://hrant-khachatrian.github.io/data-observatory/AI-papers/>.

Each paper has a stable lowercase folder containing `index.html`. The collection index is static HTML, generated from `papers.json`, with optional browser-side search.

## Adding a presentation

1. Add the deck as `<paper-slug>/index.html`. Prefer self-contained HTML with embedded figures, keyboard navigation, an all-slides view, and print CSS. Include a relative link back to `../`.
2. Add an entry to `papers.json`, following the existing schema. `slides` must match the number of `<section class="slide">` elements. Use public primary-source URLs and label illustrative examples, author claims, and evidence limitations.
3. Run `python3 AI-papers/build.py` from the repository root. This regenerates the index and checks registered slide counts, relative HTML links, and local/internal URL references. Run `python3 AI-papers/build.py --check` for validation alone.
4. Inspect the presentation in a browser, including its navigation and print layout. Check mobile readability of the collection index.
5. Commit the new folder, registry change, and regenerated index together. Preserve existing paper URLs and entries.

Never publish links or references to internal dashboards, private hosts, local files, localhost, private IP addresses, or personal filesystem paths. Keep source downloads, clones, screenshots used only for QA, and build intermediates outside this collection. The link scanner supports this rule but does not replace a content review.

Edit `index.template.html` to change the collection layout. Do not edit generated `index.html` directly.
