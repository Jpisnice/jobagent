"""Form actions for browser-use: pick a dropdown option and pick a radio / pill-button choice.

The built-in click/input actions leave the model guessing whether a custom dropdown or a
Yes/No button actually took the value. These actions do the whole interaction in one step and
read the field back, so the model gets "Now shows: Canada" or the real list of options.

The page side is plain JS run on the indexed element with Runtime.callFunctionOn, so it works
inside same-origin iframes (Greenhouse embeds) without screen coordinates. Matching happens in
Python (match_option) so it can be tested.
"""

import asyncio
import re

from browser_use import ActionResult, BrowserSession, Tools

# --- page scripts (each runs with `this` = the indexed element) ---------------------------------

_HELPERS = r"""
const doc = this.ownerDocument, win = doc.defaultView;
const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const visible = e => { const r = e.getBoundingClientRect(); const s = win.getComputedStyle(e);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
const fire = (e, type, Ctor) => e.dispatchEvent(new (Ctor || win.MouseEvent)(type, {bubbles: true, cancelable: true, view: win}));
const press = e => { e.scrollIntoView({block: 'center'});
  if (win.PointerEvent) fire(e, 'pointerdown', win.PointerEvent);
  fire(e, 'mousedown'); if (win.PointerEvent) fire(e, 'pointerup', win.PointerEvent); fire(e, 'mouseup'); e.click(); };
const findSelect = el => el.tagName === 'SELECT' ? el : (el.querySelector('select') ||
  (el.tagName === 'LABEL' && el.control && el.control.tagName === 'SELECT' ? el.control : null));
const findInput = el => el.matches('input,textarea') ? el
  : el.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea');
"""

# Open the field. Native <select>: return its options. Searchable combobox: focus and clear the
# text box so Python can type. Otherwise: click it open.
OPEN_JS = "function() {" + _HELPERS + r"""
  const sel = findSelect(this);
  if (sel) { win.__jaSelect = sel; return {kind: 'select', options: [...sel.options].map(o => clean(o.text))}; }
  const input = findInput(this);
  if (input && !input.readOnly && !input.disabled && input.type !== 'button') {
    press(input); input.focus();
    if (input.value) { input.select(); }
    return {kind: 'search', hasText: !!input.value};
  }
  press(this);
  return {kind: 'list'};
}"""

# Collect the visible options of the open popup (prefers the aria-controls / aria-owns target).
LIST_JS = "function() {" + _HELPERS + r"""
  const q = '[role=option],[role=menuitem],[role=menuitemradio],li[id*=option],[class*=option]:not([class*=options])';
  const roots = [];
  for (const host of [this, findInput(this)].filter(Boolean)) {
    for (const attr of ['aria-controls', 'aria-owns']) {
      for (const id of (host.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
        const r = doc.getElementById(id); if (r) roots.push(r);
      }
    }
  }
  let opts = [];
  for (const r of roots.length ? roots : [doc]) opts.push(...r.querySelectorAll(q));
  opts = opts.filter(o => visible(o) && clean(o.innerText) && !o.querySelector(q));
  win.__jaOpts = opts;
  return opts.map(o => clean(o.innerText));
}"""

PICK_JS = "function(i, isSelect) {" + _HELPERS + r"""
  if (isSelect) {
    const sel = win.__jaSelect; sel.selectedIndex = i;
    sel.dispatchEvent(new win.Event('input', {bubbles: true}));
    sel.dispatchEvent(new win.Event('change', {bubbles: true}));
    return true;
  }
  const o = (win.__jaOpts || [])[i]; if (!o || !o.isConnected) return false;
  if (win.PointerEvent) fire(o, 'pointerover', win.PointerEvent);
  fire(o, 'mouseover'); fire(o, 'mousemove'); press(o);
  return true;
}"""

CLOSE_JS = "function() {" + _HELPERS + r"""
  const t = findInput(this) || this;
  t.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true}));
}"""

# Empty the search box the way a framework-controlled input notices (native setter + input event).
CLEAR_JS = "function() {" + _HELPERS + r"""
  const input = findInput(this); if (!input) return;
  const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '');
  input.dispatchEvent(new win.Event('input', {bubbles: true}));
  input.focus();
}"""

# What the field shows now: selected option, input value, or the text of the control box.
READ_JS = "function() {" + _HELPERS + r"""
  const sel = findSelect(this);
  if (sel) return clean(sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '');
  const box = this.closest('[class*=-control],[class*=__control],[class*=Control]') || this.closest('[role=combobox]') || this;
  const input = findInput(this);
  return clean([input && input.value, box.innerText, this.getAttribute('aria-label')].filter(Boolean).join(' | ')).slice(0, 200);
}"""

# Find the radio / checkbox / pill-button group around the element and report each choice.
GROUP_JS = "function() {" + _HELPERS + r"""
  const labelOf = e => clean((e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label')
    || (e.closest('label') && e.closest('label').innerText) || e.innerText || e.value);
  const selected = e => e.checked === true || ['aria-checked', 'aria-pressed', 'aria-selected'].some(a => e.getAttribute(a) === 'true')
    || /^(checked|on|active|selected)$/.test(e.getAttribute('data-state') || '')
    || ['data-selected', 'data-checked'].some(a => e.hasAttribute(a) && e.getAttribute(a) !== 'false')
    || /(^|[\s_-])(selected|active|checked)($|[\s_-])/i.test(typeof e.className === 'string' ? e.className : '');
  const kinds = ['input[type=radio],input[type=checkbox]', '[role=radio],[role=checkbox],[role=switch],[role=option]',
                 '[aria-pressed]', 'button,[role=button]', 'label'];
  let el = this;
  if (el.tagName === 'LABEL' && el.control) el = el.control;
  // Only group choices of the same kind as the element given, so a lone checkbox never joins nearby radios.
  const own = kinds.find(k => el.matches(k));
  const pick = root => { for (const k of own ? [own] : kinds) {
    const xs = [...root.querySelectorAll(k)].filter(x => (visible(x) || x.matches('input')) && (!el.name || !x.name || x.name === el.name));
    if (xs.length) return xs; } return []; };
  let items = [];
  if (el.matches('input[type=radio],input[type=checkbox]') && el.name) {
    items = [...(el.form || doc).querySelectorAll('input[type=' + el.type + ']')].filter(x => x.name === el.name);
  }
  if (!items.length && el.matches('input[type=checkbox]') && !el.closest('[role=group],fieldset')) items = [el];
  if (!items.length) { const g = el.closest('[role=radiogroup],[role=group],fieldset,[role=listbox]'); if (g) items = pick(g); }
  for (let p = el.parentElement, d = 0; !items.length && p && d < 5; p = p.parentElement, d++) {
    const xs = pick(p); if (xs.length >= 2 && xs.length <= 12) items = xs;
  }
  if (!items.length) items = [el];
  win.__jaChoices = items;
  const look = e => { const s = win.getComputedStyle(e); return [e.className, s.backgroundColor, s.borderColor, s.color].join('|'); };
  return items.map(e => ({text: labelOf(e), selected: selected(e), look: look(e)}));
}"""

CLICK_CHOICE_JS = "function(i) {" + _HELPERS + r"""
  const e = (win.__jaChoices || [])[i]; if (!e) return false;
  if (e.matches('input') && e.labels && e.labels[0] && visible(e.labels[0])) e.labels[0].click();
  else press(e);
  return true;
}"""


# --- matching -----------------------------------------------------------------------------------


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


def match_option(options: list[str], value: str) -> int | None:
    """Index of the option that best matches value, or None.

    Tiers: exact, case-insensitive, option starts with value as a word, option contains value as words,
    value contains option as words ("Yes, I am authorised" -> "Yes"). The first tier with a hit wins.
    """
    v = _norm(value)
    if not v:
        return None
    if value.strip() in options:
        return options.index(value.strip())
    norm = [_norm(o) for o in options]
    tiers = [
        lambda o: o == v,
        lambda o: re.match(rf"{re.escape(v)}(?!\w)", o) is not None,
        lambda o: re.search(rf"(?<!\w){re.escape(v)}(?!\w)", o) is not None,
        lambda o: len(o) >= 2 and re.search(rf"(?<!\w){re.escape(o)}(?!\w)", v) is not None,
    ]
    for test in tiers:
        for i, o in enumerate(norm):
            if o and test(o):
                return i
    return None


# --- actions ------------------------------------------------------------------------------------


async def _js(cdp, object_id: str, fn: str, *args):
    r = await cdp.cdp_client.send.Runtime.callFunctionOn(
        params={
            "functionDeclaration": fn,
            "objectId": object_id,
            "arguments": [{"value": a} for a in args],
            "returnByValue": True,
            "awaitPromise": True,
        },
        session_id=cdp.session_id,
    )
    if "exceptionDetails" in r:
        raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description") or "page script failed")
    return r.get("result", {}).get("value")


async def _resolve(browser_session: BrowserSession, index: int):
    node = await browser_session.get_element_by_index(index)
    if node is None:
        return None, None
    cdp = await browser_session.cdp_client_for_node(node)
    obj = await cdp.cdp_client.send.DOM.resolveNode(
        params={"backendNodeId": node.backend_node_id}, session_id=cdp.session_id
    )
    return cdp, obj["object"]["objectId"]


def _gone(index: int) -> ActionResult:
    return ActionResult(error=f"Element {index} is not on the page any more. Look at the current page state again.")


def _shown(shown: str, value: str) -> bool:
    return _norm(value) in _norm(shown) or match_option([shown], value) is not None


def register(tools: Tools, is_final_submit) -> None:
    """Add choose_option and choose_choice to tools. is_final_submit(text) guards the submit button."""

    @tools.action(
        "Pick a value in a dropdown: native <select>, combobox, searchable/autocomplete select, or any "
        "field with a dropdown arrow. Opens it, types to filter when it is searchable, clicks the matching "
        "option and returns what the field shows now. If nothing matches, returns the real options."
    )
    async def choose_option(index: int, value: str, browser_session: BrowserSession) -> ActionResult:
        cdp, obj = await _resolve(browser_session, index)
        if obj is None:
            return _gone(index)
        opened = await _js(cdp, obj, OPEN_JS) or {}
        kind = opened.get("kind")

        if kind == "select":
            options = opened.get("options") or []
        else:
            if kind == "search":
                await cdp.cdp_client.send.Input.insertText(params={"text": value}, session_id=cdp.session_id)
            options = []
            for _ in range(12):  # about 3 s for options to render or load
                await asyncio.sleep(0.25)
                options = await _js(cdp, obj, LIST_JS) or []
                if options and match_option(options, value) is not None:
                    break
            if kind == "search" and match_option(options, value) is None:
                # The filter text may be too specific; show the whole list instead.
                await _js(cdp, obj, CLEAR_JS)
                await asyncio.sleep(0.5)
                options = await _js(cdp, obj, LIST_JS) or options

        i = match_option(options, value)
        if i is None or is_final_submit(options[i]):
            if kind != "select":
                await _js(cdp, obj, CLOSE_JS)
            listed = "; ".join(list(dict.fromkeys(options))[:30]) or "none found"
            return ActionResult(
                error=f'No option matches "{value}" in element {index}. Options: {listed}. '
                "Call choose_option again with the option that means the same, or leave the field and report it."
            )

        await _js(cdp, obj, PICK_JS, i, kind == "select")
        await asyncio.sleep(0.4)
        shown = await _js(cdp, obj, READ_JS) or ""
        if not _shown(shown, options[i]):
            return ActionResult(
                error=f'Clicked "{options[i]}" but element {index} shows "{shown}". Check the screenshot; '
                "if it is not set, try dropdown_options/select_dropdown or click it open and pick by hand."
            )
        return ActionResult(
            extracted_content=f'Element {index}: chose "{options[i]}". Now shows: {shown}',
            long_term_memory=f'Set dropdown {index} to "{options[i]}"',
        )

    @tools.action(
        "Pick an answer in a radio group, checkbox, Yes/No buttons or pill/segmented buttons. Give the index "
        "of any choice in the group (or the question) and the answer text. Never toggles off a choice that "
        "is already selected. Returns which choice is selected now."
    )
    async def choose_choice(index: int, value: str, browser_session: BrowserSession) -> ActionResult:
        cdp, obj = await _resolve(browser_session, index)
        if obj is None:
            return _gone(index)
        before = await _js(cdp, obj, GROUP_JS) or []
        texts = [c["text"] for c in before]
        i = match_option(texts, value)
        if i is None and len(before) == 1 and _norm(value) in {"yes", "true", "checked", "on", "agree", "i agree"}:
            i = 0  # a lone checkbox ("I agree to ...") with a yes-style answer
        if i is None or is_final_submit(texts[i]):
            return ActionResult(
                error=f'No choice matches "{value}" near element {index}. Choices: {"; ".join(texts) or "none found"}.'
            )
        if before[i]["selected"]:
            return ActionResult(
                extracted_content=f'"{texts[i]}" was already selected. Do not click it again.',
                long_term_memory=f'Choice "{texts[i]}" is selected',
            )

        await _js(cdp, obj, CLICK_CHOICE_JS, i)
        await asyncio.sleep(0.3)
        after = await _js(cdp, obj, GROUP_JS) or []
        if len(after) == len(before):
            now = [c["text"] for c in after if c["selected"]]
            if after[i]["selected"]:
                return ActionResult(
                    extracted_content=f'Selected "{texts[i]}". Selected now: {", ".join(now)}',
                    long_term_memory=f'Choice "{texts[i]}" is selected',
                )
            if after[i]["look"] != before[i]["look"]:
                return ActionResult(
                    extracted_content=f'Clicked "{texts[i]}" and its appearance changed, so it is most likely '
                    "selected. Confirm on the screenshot; do not click it again.",
                    long_term_memory=f'Clicked choice "{texts[i]}"',
                )
        return ActionResult(
            error=f'Clicked "{texts[i]}" but could not confirm it is selected. Check the screenshot before '
            "clicking again, since a second click can turn it off."
        )
