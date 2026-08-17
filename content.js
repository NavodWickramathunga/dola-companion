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
    poll: 350,
    afterClick: 900,
    menuOpen: 1600,
    bootDelay: 2500 // let the Dola app render before touching anything
  };

  const NOISE = /^(skills?|select|choose|search|none|all)$/i;

  /* ---------- small helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }

  // Text of the element itself, ignoring nested block children's noise.
  function ownText(el) {
    return norm(el.textContent).toLowerCase();
  }

  function matchesLabel(el, labels) {
    const t = ownText(el);
    if (!t || t.length > 24) return false;
    return labels.some((l) => t === l);
  }

  // Walk up to the thing that is actually clickable.
  function clickTarget(el) {
    let node = el;
    for (let i = 0; i < 5 && node; i++) {
      if (
        node.tagName === "BUTTON" ||
        node.tagName === "A" ||
        node.getAttribute("role") === "button" ||
        node.getAttribute("role") === "tab" ||
        node.getAttribute("role") === "radio" ||
        node.getAttribute("role") === "option" ||
        node.getAttribute("role") === "menuitem" ||
        node.hasAttribute("data-value") ||
        getComputedStyle(node).cursor === "pointer"
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function findByLabel(labels) {
    const nodes = document.querySelectorAll(
      'button, a, li, label, span, div, p, [role="button"], [role="tab"], [role="radio"], [role="option"], [role="menuitem"]'
    );
    const hits = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      if (!matchesLabel(el, labels)) continue;
      // Prefer the innermost element carrying the text.
      if (el.querySelector && el.querySelector(":scope *") && ownText(el) === ownText(el.firstElementChild || el)) {
        // keep going, an inner node will also match
      }
      hits.push(el);
    }
    if (!hits.length) return null;
    // Smallest box = the label itself rather than a wrapper.
    hits.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    return clickTarget(hits[0]);
  }

  async function waitForLabel(labels, timeout = TIMING.findTimeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const el = findByLabel(labels);
      if (el) return el;
      await sleep(TIMING.poll);
    }
    return null;
  }

  function looksSelected(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      const aria = node.getAttribute("aria-selected") || node.getAttribute("aria-checked") || node.getAttribute("aria-pressed");
      if (aria === "true") return true;
      if (aria === "false") return false;
      const state = node.getAttribute("data-state");
      if (state === "active" || state === "checked" || state === "on") return true;
      const cls = (node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className) || "";
      if (typeof cls === "string" && /(^|[\s_-])(active|selected|checked|current)([\s_-]|$)/i.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // React ignores plain .click() in some widgets — send the full pointer sequence.
  function realClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "instant" in window ? "instant" : "auto" });
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    try { el.dispatchEvent(new PointerEvent("pointerup", opts)); } catch (_) {}
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    if (typeof el.click === "function") { try { el.click(); } catch (_) {} }
    return true;
  }

  /* ---------- reading the Skill menu ---------- */

  function collectMenuOptions() {
    const containers = document.querySelectorAll(
      '[role="listbox"], [role="menu"], [role="dialog"], [data-radix-popper-content-wrapper], .dropdown-menu, [class*="dropdown"], [class*="popover"], [class*="menu"]'
    );
    const found = new Map();

    const pushFrom = (root) => {
      const items = root.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, [data-value]');
      for (const it of items) {
        if (!isVisible(it)) continue;
        const t = norm(it.textContent);
        if (!t || t.length > 42 || NOISE.test(t)) continue;
        if (!found.has(t)) found.set(t, true);
      }
    };

    for (const c of containers) {
      if (!isVisible(c)) continue;
      pushFrom(c);
    }
    return [...found.keys()];
  }

  async function openSkillMenu() {
    const skill = await waitForLabel(LABELS.skill, 12000);
    if (!skill) return { ok: false, error: "Could not find the Skill control on this page." };
    realClick(skill);
    await sleep(TIMING.menuOpen);
    return { ok: true, el: skill };
  }

  async function scanSkills() {
    const opened = await openSkillMenu();
    if (!opened.ok) return { ok: false, error: opened.error, skills: [] };

    let skills = collectMenuOptions();
    if (!skills.length) {
      await sleep(1200);
      skills = collectMenuOptions();
    }

    // Close the menu again so the page is left as we found it.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();

    return { ok: skills.length > 0, skills, error: skills.length ? null : "Skill menu opened but no options were readable." };
  }

  /* ---------- applying the job ---------- */

  async function selectPro() {
    const pro = await waitForLabel(LABELS.pro);
    if (!pro) return { ok: false, step: "pro", error: "Pro control not found." };
    if (looksSelected(pro)) return { ok: true, step: "pro", note: "Pro was already on." };
    realClick(pro);
    await sleep(TIMING.afterClick);
    return { ok: true, step: "pro" };
  }

  async function selectSkill(skillName) {
    const opened = await openSkillMenu();
    if (!opened.ok) return { ok: false, step: "skill", error: opened.error };
    if (!skillName) return { ok: true, step: "skill", note: "Skill menu opened, no skill chosen." };

    const wanted = norm(skillName).toLowerCase();
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      const items = document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, [data-value]');
      for (const it of items) {
        if (!isVisible(it)) continue;
        if (norm(it.textContent).toLowerCase() === wanted) {
          realClick(clickTarget(it));
          await sleep(TIMING.afterClick);
          return { ok: true, step: "skill", note: `Skill set to ${skillName}.` };
        }
      }
      await sleep(300);
    }
    return { ok: false, step: "skill", error: `Skill "${skillName}" was not in the list.` };
  }

  async function runJob(job) {
    toast("Setting up…", "working");
    await sleep(TIMING.bootDelay);

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
        "padding:10px 14px", "border-radius:10px",
        "font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace",
        "letter-spacing:.02em", "color:#0B0E14", "background:#7DF9C6",
        "box-shadow:0 8px 24px rgba(0,0,0,.35)", "pointer-events:none",
        "transition:opacity .3s ease"
      ].join(";");
      document.documentElement.appendChild(pill);
    }
    pill.style.background = state === "warn" ? "#FFC24B" : state === "working" ? "#9DB2FF" : "#7DF9C6";
    pill.textContent = `Soori Academy · ${text}`;
    if (state !== "working") {
      setTimeout(() => { pill.style.opacity = "0"; }, 4500);
    }
  }

  /* ---------- wiring ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "SCAN_SKILLS") return;
    scanSkills().then(sendResponse).catch((e) => sendResponse({ ok: false, skills: [], error: String(e) }));
    return true;
  });

  // Ask the background whether this tab was opened by the extension.
  chrome.runtime.sendMessage({ type: "GET_JOB" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.job) runJob(res.job);
  });
})();
