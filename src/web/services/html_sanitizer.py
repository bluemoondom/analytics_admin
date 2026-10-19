"""Allowlist sanitizer for the rich-text chart descriptions.

The description editor produces a small subset of HTML. Everything that is not
on the allowlist is dropped before the text is stored, so a description can
never carry scripts, event handlers, styles or foreign markup, whatever the
client sends:

* allowed tags keep only their allowed attributes;
* unknown tags are removed but their text is kept;
* the content of ``script``, ``style`` and similar tags is removed entirely;
* links keep only ``http``, ``https`` and ``mailto`` targets and always open
  in a new tab without access to the opener;
* column references are ``<span class="col-ref" data-col="...">``.

Only the standard library is used.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser

MAX_DESCRIPTION_LENGTH = 20_000

# tag -> allowed attributes
_ALLOWED: dict[str, set[str]] = {
    "p": set(),
    "div": set(),
    "br": set(),
    "b": set(),
    "strong": set(),
    "i": set(),
    "em": set(),
    "u": set(),
    "mark": set(),
    "ul": set(),
    "ol": set(),
    "li": set(),
    "a": {"href"},
    "span": {"class", "data-col"},
}
_VOID = {"br"}
# Content of these tags is dropped together with the tag.
_DROP_CONTENT = {"script", "style", "template", "iframe", "object", "embed", "noscript", "svg", "math", "head", "title", "textarea", "select"}
_SAFE_URL = re.compile(r"^(https?:|mailto:)", re.IGNORECASE)
_COLUMN_NAME = re.compile(r"^[^<>\"'`]{1,200}$")


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.drop_depth = 0

    # -- helpers ---------------------------------------------------------
    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str | None:
        """Return the serialized allowed attributes, or None to skip the tag."""
        allowed = _ALLOWED[tag]
        values = {k.lower(): (v or "") for k, v in attrs if k.lower() in allowed}
        if tag == "a":
            href = values.get("href", "").strip()
            # Browsers ignore control characters and whitespace inside schemes.
            compact = re.sub(r"[\x00-\x20]", "", href)
            if not href or not _SAFE_URL.match(compact):
                return ""  # keep the text, drop the link target
            return (
                f' href="{html.escape(href, quote=True)}"'
                ' target="_blank" rel="noopener noreferrer"'
            )
        if tag == "span":
            if values.get("class") != "col-ref":
                return None  # plain spans carry nothing worth keeping
            col = values.get("data-col", "")
            if not _COLUMN_NAME.match(col):
                return None
            return f' class="col-ref" data-col="{html.escape(col, quote=True)}"'
        return ""

    # -- parser callbacks -------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            self.drop_depth += 1
            return
        if self.drop_depth or tag not in _ALLOWED:
            return
        rendered = self._attrs(tag, attrs)
        if rendered is None:
            return
        if tag == "a" and rendered == "":
            # Unsafe or missing link target: keep the text only.
            self.open.append("a!")
            return
        self.out.append(f"<{tag}{rendered}>")
        if tag not in _VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _VOID and not self.drop_depth:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _DROP_CONTENT:
            self.drop_depth = max(0, self.drop_depth - 1)
            return
        if self.drop_depth or tag in _VOID:
            return
        targets = {"a", "a!"} if tag == "a" else {tag}
        idx = next((i for i in range(len(self.open) - 1, -1, -1) if self.open[i] in targets), None)
        if idx is None:
            return
        # Close everything opened after the matching tag, so the output stays well-formed.
        while len(self.open) > idx:
            current = self.open.pop()
            if current != "a!":
                self.out.append(f"</{current}>")

    def handle_data(self, data: str) -> None:
        if not self.drop_depth:
            self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.open:
            current = self.open.pop()
            if current != "a!":
                self.out.append(f"</{current}>")
        return "".join(self.out)


def sanitize_description(value: str | None) -> str:
    """Return the description reduced to the allowed HTML subset."""
    if not value:
        return ""
    parser = _Sanitizer()
    parser.feed(str(value)[: MAX_DESCRIPTION_LENGTH * 2])
    parser.close()
    cleaned = parser.result().strip()
    if len(cleaned) > MAX_DESCRIPTION_LENGTH:
        raise ValueError(
            f"Popis grafu je příliš dlouhý (max. {MAX_DESCRIPTION_LENGTH} znaků)."
        )
    # A description that is only empty markup (e.g. "<p><br></p>") is no description.
    text_only = html.unescape(re.sub(r"<[^>]+>", "", cleaned)).strip()
    if not text_only and "col-ref" not in cleaned:
        return ""
    return cleaned
