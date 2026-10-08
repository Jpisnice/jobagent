"""Form actions for browser-use: pick a dropdown option and pick a radio / pill-button choice.

The built-in click/input actions leave the model guessing whether a custom dropdown or a
Yes/No button actually took the value. These actions do the whole interaction in one step and
read the field back, so the model gets "Now shows: Canada" or the real list of options.

The page side is plain JS run on the indexed element with Runtime.callFunctionOn, so it works
inside same-origin iframes (Greenhouse embeds) without screen coordinates. Matching and the
"did it take?" decisions happen in Python so they can be tested.
"""

import asyncio
import re
from collections.abc import Callable

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
// The <select> behind a field: itself, inside it, its label's control, or a hidden <select> right
// beside it (Select2, Chosen and bootstrap-select hide the real one next to their own widget).
const findSelect = el => el.tagName === 'SELECT' ? el : (el.querySelector('select') ||
  (el.tagName === 'LABEL' && el.control && el.control.tagName === 'SELECT' ? el.control : null) ||
  (el.parentElement && [...el.parentElement.children].find(s => s.tagName === 'SELECT' && !visible(s))) || null);
const findInput = el => el.matches('input,textarea') ? el
  : el.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea');
const setValue = (input, v) => {
  const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, v);
  input.dispatchEvent(new win.Event('input', {bubbles: true}));
};
// The indexed element, or the element that replaced it after a re-render (found again by id).
const field = () => this.isConnected ? this : ((win.__jaAnchor && doc.getElementById(win.__jaAnchor)) || this);
"""

# Open the field. Native <select>: return its options. Searchable combobox: focus and select its
# text so Python can type over it. Otherwise: click it open. Remembers the previous text and an id
# to find the field again if the page re-renders it.
OPEN_JS = "function() {" + _HELPERS + r"""
  const input = findInput(this);
  const anchor = [this, input, this.closest('[id]')].find(e => e && e.id);
  win.__jaAnchor = anchor ? anchor.id : null;
  const sel = findSelect(this);
  if (sel) { win.__jaSelect = sel; return {kind: 'select', options: [...sel.options].map(o => clean(o.text))}; }
  if (input && !input.readOnly && !input.disabled && input.type !== 'button') {
    win.__jaPrev = input.value;
    press(input); input.focus();
    if (input.value) { input.select(); }
    return {kind: 'search'};
  }
  press(this);
  return {kind: 'list'};
}"""

# Collect the visible options of the open popup (prefers the aria-controls / aria-owns target).
LIST_JS = "function() {" + _HELPERS + r"""
  const q = '[role=option],[role=menuitem],[role=menuitemradio],li[id*=option],[class*=option]:not([class*=options])';
  const roots = [];
  for (const host of [field(), findInput(field())].filter(Boolean)) {
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
    // Select2 / Chosen / bootstrap-select hide the real <select> and re-render on jQuery events.
    if (win.jQuery) { try { win.jQuery(sel).trigger('change').trigger('chosen:updated'); } catch (e) {} }
    return true;
  }
  const o = (win.__jaOpts || [])[i]; if (!o || !o.isConnected) return false;
  if (win.PointerEvent) fire(o, 'pointerover', win.PointerEvent);
  fire(o, 'mouseover'); fire(o, 'mousemove'); press(o);
  return true;
}"""

# Close the popup. With restore, also put back the text the search box had before we typed.
CLOSE_JS = "function(restore) {" + _HELPERS + r"""
  const t = findInput(field()) || field();
  if (restore && t.matches('input,textarea') && typeof win.__jaPrev === 'string') setValue(t, win.__jaPrev);
  t.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true}));
}"""

# Empty the search box so the whole option list shows.
CLEAR_JS = "function() {" + _HELPERS + r"""
  const input = findInput(field()); if (!input) return;
  setValue(input, ''); input.focus();
}"""

# What the field shows now, without the text we typed into it:
#   select:  the selected option, plus the visible widget's text when the <select> itself is hidden
#   other:   the control box's visible text, the input's value, and whether the popup is still open
READ_JS = "function(i) {" + _HELPERS + r"""
  const el = field();
  const sel = findSelect(el);
  if (sel) {
    const value = clean(sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '');
    if (visible(sel)) return {value, hidden: false};
    const widget = el !== sel ? el : sel.nextElementSibling;
    return {value, hidden: true, widget: widget ? clean(widget.innerText).slice(0, 200) : null};
  }
  const box = el.closest('[class*=-control],[class*=__control],[class*=Control]') || el.closest('[role=combobox]') || el;
  const input = findInput(el);
  const o = (win.__jaOpts || [])[i];
  return {box: clean(box.innerText).slice(0, 200), input: input ? clean(input.value) : '',
          menuOpen: !!(o && o.isConnected && visible(o))};
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
  win.__jaChoiceSelected = selected;
  const look = e => { const s = win.getComputedStyle(e); return [e.className, s.backgroundColor, s.borderColor, s.color].join('|'); };
  win.__jaLook = look;
  // A <button> with no type inside a form submits it, so report its effective type.
  const typeOf = e => e.tagName === 'BUTTON' ? (e.getAttribute('type') || (e.form ? 'submit' : 'button')).toLowerCase()
    : (e.getAttribute('type') || '').toLowerCase();
  return items.map(e => ({text: labelOf(e), selected: selected(e), look: look(e), type: typeOf(e)}));
}"""

CLICK_CHOICE_JS = "function(i) {" + _HELPERS + r"""
  const e = (win.__jaChoices || [])[i]; if (!e) return false;
  if (e.matches('input') && e.labels && e.labels[0] && visible(e.labels[0])) e.labels[0].click();
  else press(e);
  return true;
}"""

# State of the clicked choice itself, even if the group around it grew (a follow-up question
# appeared). Returns null when the page replaced the element, so Python falls back to GROUP_JS.
CHOICE_STATE_JS = "function(i) {" + _HELPERS + r"""
  const e = (win.__jaChoices || [])[i];
  if (!e || !e.isConnected) return null;
  return {selected: win.__jaChoiceSelected(e), look: win.__jaLook(e)};
}"""


# --- matching -----------------------------------------------------------------------------------


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


def _has_words(text: str, words: str) -> bool:
    """words appears in text as whole words (so "no" is not found in "know")."""
    return bool(words) and re.search(rf"(?<!\w){re.escape(words)}(?!\w)", text) is not None


def match_options(options: list[str], value: str) -> list[int]:
    """Indexes of the options that match value best: every hit in the first tier that has one.

    Tiers: exact, case-insensitive, option starts with value, option contains value, value starts
    with option ("Yes, I am authorised" -> "Yes"), value contains option. Words are whole words.
    """
    v = _norm(value)
    if not v:
        return []
    exact = [i for i, o in enumerate(options) if o.strip() == value.strip()]
    if exact:
        return exact
    norm = [_norm(o) for o in options]
    tiers = [
        lambda o: o == v,
        lambda o: re.match(rf"{re.escape(v)}(?!\w)", o) is not None,
        lambda o: _has_words(o, v),
        lambda o: re.match(rf"{re.escape(o)}(?!\w)", v) is not None,
        lambda o: len(o) >= 2 and _has_words(v, o),
    ]
    for test in tiers:
        hits = [i for i, o in enumerate(norm) if o and test(o)]
        if hits:
            return hits
    return []


def match_option(options: list[str], value: str) -> int | None:
    """The single option value means, or None when nothing matches or it is ambiguous."""
    hits = match_options(options, value)
    return hits[0] if hits and len({_norm(options[i]) for i in hits}) == 1 else None


def no_match_message(options: list[str], value: str, what: str) -> str:
    hits = match_options(options, value)
    if len(hits) > 1:
        listed = "; ".join(dict.fromkeys(options[i] for i in hits))
        return f'"{value}" could mean more than one {what}: {listed}. Call again with the exact text of the right one.'
    listed = "; ".join(list(dict.fromkeys(o for o in options if o))[:30]) or "none found"
    return (
        f'No {what} matches "{value}". {what.capitalize()}s: {listed}. Call again with the one that means '
        "the same, or leave the field and report it."
    )


def option_took(read: dict, option: str, kind: str, typed: str) -> tuple[bool, str]:
    """Did the field take the option? Returns (ok, what the field shows) from a READ_JS result."""
    if kind == "select":
        if not read.get("hidden"):
            return _norm(read.get("value")) == _norm(option), read.get("value") or ""
        widget = read.get("widget")
        if widget is None:  # hidden select with no visible widget we can find: trust the select
            return _norm(read.get("value")) == _norm(option), read.get("value") or ""
        return _norm(read.get("value")) == _norm(option) and _has_words(_norm(widget), _norm(option)), widget
    box, value = read.get("box") or "", read.get("input") or ""
    if _has_words(_norm(box), _norm(option)):
        return True, box
    # A plain autocomplete puts the choice in the input itself. Our own typing doesn't count unless
    # the popup closed, which is what a real pick does.
    if _norm(value) == _norm(option) and (_norm(value) != _norm(typed) or not read.get("menuOpen")):
        return True, value
    return False, box or value


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


SubmitCheck = Callable[[str, str], bool]  # (label, type attribute) -> is it the final submit button?


def register(tools: Tools, is_final_submit: SubmitCheck) -> None:
    """Add choose_option and choose_choice to tools. is_final_submit guards the submit button."""

    # terminates_sequence: the popup or a revealed follow-up question changes the page, so any
    # action queued after this one in the same step would use stale element indexes.
    @tools.action(
        "Pick a value in a dropdown: native <select>, combobox, searchable/autocomplete select, or any "
        "field with a dropdown arrow. Opens it, types to filter when it is searchable, clicks the matching "
        "option and returns what the field shows now. If nothing matches, returns the real options.",
        terminates_sequence=True,
    )
    async def choose_option(index: int, value: str, browser_session: BrowserSession) -> ActionResult:
        cdp, obj = await _resolve(browser_session, index)
        if obj is None:
            return _gone(index)
        opened = await _js(cdp, obj, OPEN_JS) or {}
        kind = opened.get("kind")
        typed = ""

        if kind == "select":
            options = opened.get("options") or []
        else:
            if kind == "search":
                typed = value
                await cdp.cdp_client.send.Input.insertText(params={"text": value}, session_id=cdp.session_id)
            options = []
            for _ in range(12):  # about 3 s for options to render or load
                await asyncio.sleep(0.25)
                options = await _js(cdp, obj, LIST_JS) or []
                if options and match_options(options, value):
                    break
            if kind == "search" and not match_options(options, value):
                # The filter text may be too specific; show the whole list instead.
                await _js(cdp, obj, CLEAR_JS)
                typed = ""
                await asyncio.sleep(0.5)
                options = await _js(cdp, obj, LIST_JS) or options

        i = match_option(options, value)
        if i is None or is_final_submit(options[i], ""):
            if kind != "select":
                await _js(cdp, obj, CLOSE_JS, kind == "search")  # put back what the box had before
            return ActionResult(error=f"Element {index}: " + no_match_message(options, value, "option"))

        await _js(cdp, obj, PICK_JS, i, kind == "select")
        await asyncio.sleep(0.4)
        ok, shown = option_took(await _js(cdp, obj, READ_JS, i) or {}, options[i], kind, typed)
        if not ok:
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
        "is already selected. Returns which choice is selected now.",
        terminates_sequence=True,
    )
    async def choose_choice(index: int, value: str, browser_session: BrowserSession) -> ActionResult:
        cdp, obj = await _resolve(browser_session, index)
        if obj is None:
            return _gone(index)
        before = await _js(cdp, obj, GROUP_JS) or []
        # Never offer the submit button as an answer, whatever the group search picked up.
        usable = [k for k, c in enumerate(before) if not is_final_submit(c["text"], c.get("type", ""))]
        texts = [before[k]["text"] for k in usable]
        j = match_option(texts, value)
        if j is None and len(usable) == 1 and _norm(value) in {"yes", "true", "checked", "on", "agree", "i agree"}:
            j = 0  # a lone checkbox ("I agree to ...") with a yes-style answer
        if j is None:
            return ActionResult(error=f"Near element {index}: " + no_match_message(texts, value, "choice"))
        i, text = usable[j], texts[j]
        if before[i]["selected"]:
            return ActionResult(
                extracted_content=f'"{text}" was already selected. Do not click it again.',
                long_term_memory=f'Choice "{text}" is selected',
            )

        await _js(cdp, obj, CLICK_CHOICE_JS, i)
        await asyncio.sleep(0.3)
        state = await _js(cdp, obj, CHOICE_STATE_JS, i)
        if state is None:  # the page re-rendered the choice: find it again by its text
            after = await _js(cdp, obj, GROUP_JS) or []
            again = [c for c in after if _norm(c["text"]) == _norm(text)]
            state = again[0] if again else None
        if state and state["selected"]:
            return ActionResult(
                extracted_content=f'Selected "{text}".',
                long_term_memory=f'Choice "{text}" is selected',
            )
        if state and state["look"] != before[i]["look"]:
            return ActionResult(
                extracted_content=f'Clicked "{text}" and its appearance changed, so it is most likely '
                "selected. Confirm on the screenshot; do not click it again.",
                long_term_memory=f'Clicked choice "{text}"',
            )
        return ActionResult(
            error=f'Clicked "{text}" but could not confirm it is selected. Check the screenshot before '
            "clicking again, since a second click can turn it off."
        )
