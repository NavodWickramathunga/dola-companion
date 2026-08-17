/* Dola Multi-Tab — content script (runs on dola.com)
 * Created by Soori Academy, Sri Lanka
 *
 * Two jobs:
 *   1) SCAN_SKILLS  -> open the Skill menu, read every option name, send them to the popup.
 *   2) Apply a job  -> switch Fast to Pro, open Skill, pick the chosen skill.
 *
 * Dola is a React app and its class names change between releases, so nothing here
 * depends on a fixed CSS class. Everything is matched by the visible label text.
 * If Dola renames a control, change the words in LABELS below — that is the only edit needed.
 *
 * Nothing here sleeps for a guessed number of milliseconds. Every step waits for the
 * condition it actually needs, because these tabs run in the background where Chrome
 * throttles timers and the app can take far longer to boot than it does in the foreground.
 */

(() => {
  "use strict";

  const LABELS = {
    pro: ["pro"],
    fast: ["fast"],
    skill: ["skill", "skills"]
  };

  const TIMING = {
    findTimeout: 30000, // how long to wait for a control to exist
    boot: 45000, // ceiling on waiting for the app's own controls to render
    menuOpen: 8000, // waiting for menu options to appear
    confirm: 6000, // waiting for a click to visibly take effect
    poll: 250
  };

  const NOISE = /^(skills?|select|choose|search|none|all)$/i;

  // A shared ancestor this high up means the two elements are unrelated.
  const TOO_BROAD = new Set(["BODY", "HTML", "MAIN", "#document"]);

  // Fast and Pro are two halves of one switch, so they sit close together in the
  // tree. Anything further apart than this is a coincidence, not a pairing.
  const MAX_PAIR_STEPS = 4;

  /* ---------- small helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Poll a predicate until it is truthy or the timeout runs out.
  // Returns the predicate's value, or null on timeout.
  async function waitFor(predicate, timeout, poll = TIMING.poll) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let value = null;
      try {
        value = await predicate();
      } catch (_) {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(poll);
    }
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }

  function area(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  // Full visible text of the element including descendants.
  function allText(el) {
    return norm(el.textContent).toLowerCase();
  }

  function matchesLabel(el, labels) {
    const t = allText(el);
    if (!t || t.length > 24) return false;
    return labels.some((l) => t === l);
  }

  function isClickable(node) {
    return (
      node.tagName === "BUTTON" ||
      node.tagName === "A" ||
      node.getAttribute("role") === "button" ||
      node.getAttribute("role") === "tab" ||
      node.getAttribute("role") === "radio" ||
      node.getAttribute("role") === "option" ||
      node.getAttribute("role") === "menuitem" ||
      node.getAttribute("role") === "menuitemradio" ||
      node.hasAttribute("data-value") ||
      getComputedStyle(node).cursor === "pointer"
    );
  }

  // Walk up to the thing that is actually clickable.
  // Returns null when there is none — dispatching events at a plain <span>
  // that no handler listens to just fails silently.
  function clickTarget(el) {
    let node = el;
    for (let i = 0; i < 5 && node; i++) {
      if (isClickable(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /* ---------- locating controls ---------- */

  const CANDIDATE_SELECTOR =
    'button, a, li, label, span, div, p, [role="button"], [role="tab"], [role="radio"], [role="option"], [role="menuitem"]';

  // Every clickable control whose visible label matches, smallest box first.
  // The smallest box is the label itself rather than an outer wrapper.
  function findCandidates(labels) {
    const hits = [];
    for (const el of document.querySelectorAll(CANDIDATE_SELECTOR)) {
      if (!isVisible(el)) continue;
      if (!matchesLabel(el, labels)) continue;
      const target = clickTarget(el);
      if (!target) continue;
      if (!hits.includes(target)) hits.push(target);
    }
    hits.sort((a, b) => area(a) - area(b));
    return hits;
  }

  function findByLabel(labels) {
    return findCandidates(labels)[0] || null;
  }

  // Nearest ancestor shared by both nodes, and how many steps up it took in total.
  function commonAncestor(a, b) {
    const depths = new Map();
    let node = a;
    let d = 0;
    while (node) {
      depths.set(node, d++);
      node = node.parentElement;
    }
    node = b;
    d = 0;
    while (node) {
      if (depths.has(node)) return { ancestor: node, steps: depths.get(node) + d };
      d++;
      node = node.parentElement;
    }
    return null;
  }

  // How tightly two elements belong to the same widget. Infinity = unrelated.
  function pairDistance(a, b) {
    const found = commonAncestor(a, b);
    if (!found) return Infinity;
    // Every pair of elements on the page shares <body> within a few steps, so a
    // shared ancestor that broad tells us nothing at all.
    if (TOO_BROAD.has(found.ancestor.tagName)) return Infinity;
    return found.steps;
  }

  // The Pro button is the one paired with a Fast button — they are the two halves
  // of the same switch. Without this, a decorative "Pro" badge elsewhere on the
  // page wins on the smallest-box heuristic and every click goes nowhere.
  function findProControl() {
    const pros = findCandidates(LABELS.pro);
    if (!pros.length) return null;

    const fasts = findCandidates(LABELS.fast);
    if (fasts.length) {
      let best = null;
      let bestSteps = Infinity;
      for (const pro of pros) {
        for (const fast of fasts) {
          if (pro === fast) continue;
          const steps = pairDistance(pro, fast);
          if (steps < bestSteps) {
            bestSteps = steps;
            best = pro;
          }
        }
      }
      if (best && bestSteps <= MAX_PAIR_STEPS) return best;
    }

    // No Fast anywhere near a Pro — the switch may already be collapsed to a
    // single control. Fall back to the smallest matching box.
    return pros[0];
  }

  function looksSelected(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      const aria =
        node.getAttribute("aria-selected") ||
        node.getAttribute("aria-checked") ||
        node.getAttribute("aria-pressed");
      if (aria === "true") return true;
      if (aria === "false") return false;
      const state = node.getAttribute("data-state");
      if (state === "active" || state === "checked" || state === "on") return true;
      const cls =
        (node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className) || "";
      if (typeof cls === "string" && /(^|[\s_-])(active|selected|checked|current)([\s_-]|$)/i.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /* ---------- clicking ---------- */

  let pointerId = 1;

  // React ignores plain .click() in some widgets — send the full pointer sequence.
  // Radix-style components check pointerType and isPrimary before accepting an
  // event, so those fields are not optional.
  function realClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "instant" in window ? "instant" : "auto" });
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
      pointerId: pointerId++,
      pointerType: "mouse",
      isPrimary: true
    };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 })); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 }));
    return true;
  }

  // A second, different attempt — only worth using after a synthetic click has
  // provably failed. Firing both every time double-toggles anything that does
  // accept the synthetic sequence.
  function nativeClick(el) {
    if (!el || typeof el.click !== "function") return false;
    try { el.click(); return true; } catch (_) { return false; }
  }

  /* ---------- reading the Skill menu ---------- */

  function menuContainers() {
    // Deliberately narrow. A [class*="menu"] match pulls in the site's own nav
    // bars and fills the skill list with page furniture.
    return document.querySelectorAll(
      '[role="listbox"], [role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]'
    );
  }

  function collectMenuOptions() {
    const found = new Map();

    for (const c of menuContainers()) {
      if (!isVisible(c)) continue;
      const items = c.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, [data-value]');
      for (const it of items) {
        if (!isVisible(it)) continue;
        const t = norm(it.textContent);
        if (!t || t.length > 42 || NOISE.test(t)) continue;
        if (!found.has(t)) found.set(t, true);
      }
    }
    return [...found.keys()];
  }

  function closeMenu(trigger) {
    // Escape on the document, never a click on <body> — that lands a real click
    // on whatever element happens to sit underneath.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    if (trigger && document.contains(trigger) && collectMenuOptions().length) {
      realClick(trigger); // toggle it shut if Escape was ignored
    }
  }

  async function openSkillMenu() {
    const skill = await waitFor(() => findByLabel(LABELS.skill), TIMING.findTimeout);
    if (!skill) return { ok: false, error: "Could not find the Skill control on this page." };

    realClick(skill);
    let opened = await waitFor(() => collectMenuOptions().length > 0, TIMING.menuOpen);

    if (!opened) {
      nativeClick(skill); // deliberate second attempt
      opened = await waitFor(() => collectMenuOptions().length > 0, TIMING.menuOpen);
    }
    if (!opened) return { ok: false, error: "Clicked Skill but no menu opened.", el: skill };

    return { ok: true, el: skill };
  }

  async function scanSkills() {
    const opened = await openSkillMenu();
    if (!opened.ok) return { ok: false, error: opened.error, skills: [] };

    const skills = collectMenuOptions();

    // Leave the page as we found it.
    closeMenu(opened.el);

    return {
      ok: skills.length > 0,
      skills,
      error: skills.length ? null : "Skill menu opened but no options were readable."
    };
  }

  /* ---------- applying the job ---------- */

  async function selectPro() {
    const pro = await waitFor(findProControl, TIMING.findTimeout);
    if (!pro) return { ok: false, step: "pro", error: "Pro control not found." };
    if (looksSelected(pro)) return { ok: true, step: "pro", note: "Pro was already on." };

    const isNowSelected = () => {
      const now = findProControl();
      return now && looksSelected(now);
    };

    realClick(pro);
    let confirmed = await waitFor(isNowSelected, TIMING.confirm);

    if (!confirmed) {
      nativeClick(findProControl() || pro); // deliberate second attempt
      confirmed = await waitFor(isNowSelected, TIMING.confirm);
    }

    // Never report success on an unverified click. A green "Pro ✓" on a tab
    // still set to Fast is worse than an honest failure.
    if (!confirmed) {
      return { ok: false, step: "pro", error: "Clicked Pro but the control did not switch." };
    }
    return { ok: true, step: "pro" };
  }

  function findMenuItem(wanted) {
    for (const c of menuContainers()) {
      if (!isVisible(c)) continue;
      const items = c.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, [data-value]');
      for (const it of items) {
        if (!isVisible(it)) continue;
        if (norm(it.textContent).toLowerCase() !== wanted) continue;
        const target = clickTarget(it);
        if (target) return target;
      }
    }
    return null;
  }

  async function selectSkill(skillName) {
    const opened = await openSkillMenu();
    if (!opened.ok) return { ok: false, step: "skill", error: opened.error };
    if (!skillName) return { ok: true, step: "skill", note: "Skill menu opened, no skill chosen." };

    const wanted = norm(skillName).toLowerCase();
    const item = await waitFor(() => findMenuItem(wanted), TIMING.menuOpen);
    if (!item) return { ok: false, step: "skill", error: `Skill "${skillName}" was not in the list.` };

    realClick(item);

    // The menu closing is the app acknowledging the choice.
    let applied = await waitFor(() => !document.contains(item) || !isVisible(item), TIMING.confirm);
    if (!applied) {
      nativeClick(item); // deliberate second attempt
      applied = await waitFor(() => !document.contains(item) || !isVisible(item), TIMING.confirm);
    }
    if (!applied) {
      return { ok: false, step: "skill", error: `Clicked "${skillName}" but the menu did not respond.` };
    }

    return { ok: true, step: "skill", note: `Skill set to ${skillName}.` };
  }

  async function runJob(job) {
    toast("Setting up…", "working");

    // Wait for the app's own controls, not for a guessed number of milliseconds.
    // This is a background tab, where Chrome clamps timers and boot is slower.
    const ready = await waitFor(
      () => findProControl() || findByLabel(LABELS.skill),
      TIMING.boot
    );
    if (!ready) {
      toast("Dola did not finish loading in this tab.", "warn");
      chrome.runtime.sendMessage(
        { type: "JOB_RESULT", payload: [{ ok: false, step: "boot", error: "App never rendered." }] },
        () => void chrome.runtime.lastError
      );
      return;
    }

    const results = [];
    if (job.pro) results.push(await selectPro());
    results.push(await selectSkill(job.skill));

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      toast(failed[0].error || "Some settings could not be applied.", "warn");
    } else {
      toast(job.skill ? `Pro · ${job.skill}` : "Pro selected", "done");
    }

    chrome.runtime.sendMessage({ type: "JOB_RESULT", payload: results }, () => void chrome.runtime.lastError);
  }

  /* ---------- tiny on-page status pill ---------- */

  function toast(text, state) {
    let pill = document.getElementById("soori-dola-pill");
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "soori-dola-pill";
      pill.style.cssText = [
        "position:fixed", "z-index:2147483647", "right:16px", "bottom:16px",
        "max-width:320px",
        "padding:10px 14px", "border-radius:10px",
        "font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace",
        "letter-spacing:.02em", "color:#0B0E14", "background:#7DF9C6",
        "box-shadow:0 8px 24px rgba(0,0,0,.35)", "pointer-events:none",
        "transition:opacity .3s ease"
      ].join(";");
      document.documentElement.appendChild(pill);
    }
    pill.style.opacity = "1";
    pill.style.background = state === "warn" ? "#FFC24B" : state === "working" ? "#9DB2FF" : "#7DF9C6";
    pill.textContent = `Soori Academy · ${text}`;
    // Failures stay put; there is nothing useful about a warning that vanishes.
    if (state === "done") {
      setTimeout(() => { pill.style.opacity = "0"; }, 4500);
    }
  }

  /* ---------- wiring ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "SCAN_SKILLS") return;
    scanSkills()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, skills: [], error: String((e && e.message) || e) }));
    return true;
  });

  // Ask the background whether this tab was opened by the extension.
  chrome.runtime.sendMessage({ type: "GET_JOB" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.job) runJob(res.job);
  });
})();
