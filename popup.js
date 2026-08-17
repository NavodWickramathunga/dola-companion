/* Dola Multi-Tab — popup
 * Created by Soori Academy, Sri Lanka
 */

const MAX_TABS = 20;
const DOLA_HOST = /^https:\/\/(www\.)?dola\.com\//i;

const el = {
  panel: document.getElementById("panel"),
  siteState: document.getElementById("site-state"),
  count: document.getElementById("count"),
  countOut: document.getElementById("count-out"),
  ticks: document.getElementById("ticks"),
  auto: document.getElementById("auto"),
  skillArea: document.getElementById("skill-area"),
  skill: document.getElementById("skill"),
  loadSkills: document.getElementById("load-skills"),
  skillNote: document.getElementById("skill-note"),
  go: document.getElementById("go"),
  status: document.getElementById("status")
};

let activeTab = null;

/* ---------- tick strip: one mark per tab, 20 total ---------- */
for (let i = 0; i < MAX_TABS; i++) el.ticks.appendChild(document.createElement("i"));
const tickNodes = [...el.ticks.children];

function paint() {
  const n = Number(el.count.value);
  el.countOut.textContent = n;
  tickNodes.forEach((t, i) => t.classList.toggle("on", i < n));
}

function setStatus(text, kind) {
  el.status.textContent = text || "";
  el.status.className = "status" + (kind ? " " + kind : "");
}

function lock(reason) {
  el.panel.classList.add("locked");
  el.panel.setAttribute("aria-busy", "true");
  // The .locked class only sets pointer-events:none, which a keyboard walks
  // straight past. Take the controls out of the tab order for real.
  el.panel.inert = true;
  for (const node of el.panel.querySelectorAll("input, select, button")) {
    node.disabled = true;
  }
  el.siteState.textContent = reason;
  el.siteState.className = "state state--off";
}

/* ---------- boot ---------- */
(async function init() {
  paint();

  const stored = await chrome.storage.local.get(["count", "auto", "skill", "skillList"]);
  if (stored.count) { el.count.value = Math.min(MAX_TABS, stored.count); paint(); }
  if (typeof stored.auto === "boolean") el.auto.checked = stored.auto;
  if (Array.isArray(stored.skillList) && stored.skillList.length) {
    fillSkills(stored.skillList, stored.skill || "");
    el.skillNote.textContent = "Skill list saved from your last Load.";
  }
  el.skillArea.classList.toggle("hidden", !el.auto.checked);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  if (!tab || !DOLA_HOST.test(tab.url || "")) {
    lock("Open dola.com/chat to use this");
    setStatus("This extension only runs on dola.com.", "err");
    return;
  }

  el.siteState.textContent = "dola.com is open";
  el.siteState.className = "state state--ok";
})();

/* ---------- controls ---------- */
el.count.addEventListener("input", paint);

el.auto.addEventListener("change", () => {
  el.skillArea.classList.toggle("hidden", !el.auto.checked);
});

function fillSkills(list, selected) {
  el.skill.length = 1; // keep the "Open Skill menu only" row
  for (const name of list) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    el.skill.appendChild(opt);
  }
  if (selected) el.skill.value = selected;
}

el.loadSkills.addEventListener("click", async () => {
  if (!activeTab) return;
  el.loadSkills.disabled = true;
  el.skillNote.textContent = "Reading the Skill menu on your Dola tab…";

  chrome.tabs.sendMessage(activeTab.id, { type: "SCAN_SKILLS" }, async (res) => {
    el.loadSkills.disabled = false;

    if (chrome.runtime.lastError) {
      el.skillNote.textContent = "Could not reach the page. Reload the Dola tab and try Load again.";
      return;
    }
    if (!res || !res.skills || !res.skills.length) {
      el.skillNote.textContent = (res && res.error) || "No skills found. Open the Skill menu once by hand, then press Load.";
      return;
    }

    fillSkills(res.skills, "");
    await chrome.storage.local.set({ skillList: res.skills });
    el.skillNote.textContent = `${res.skills.length} skills loaded from Dola.`;
  });
});

el.go.addEventListener("click", async () => {
  if (!activeTab) return;

  const count = Math.max(1, Math.min(MAX_TABS, Number(el.count.value) || 1));
  const applySettings = el.auto.checked;
  const skill = applySettings ? el.skill.value : "";

  await chrome.storage.local.set({ count, auto: applySettings, skill });

  el.go.disabled = true;
  setStatus(`Opening ${count} tab${count > 1 ? "s" : ""}…`);

  chrome.runtime.sendMessage(
    { type: "DUPLICATE_TABS", payload: { sourceTabId: activeTab.id, count, applySettings, skill } },
    (res) => {
      el.go.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus("Something blocked the request. Reload the extension.", "err");
        return;
      }
      if (!res || !res.ok) {
        setStatus((res && res.error) || "Could not open the tabs.", "err");
        return;
      }
      setStatus(
        applySettings
          ? `${res.count} tabs open. Each one is switching to Pro${skill ? " · " + skill : ""}.`
          : `${res.count} tabs open.`,
        "ok"
      );
    }
  );
});
