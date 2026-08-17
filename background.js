/* Dola Multi-Tab — background service worker
 * Created by Soori Academy, Sri Lanka
 *
 * Responsibilities:
 *  - Open N copies of the active Dola tab (hard cap 20)
 *  - Remember which new tabs must be auto-configured (Pro + Skill)
 *  - Hand that config to the content script when the new tab asks for it
 *
 * The pending-job list lives in chrome.storage.session, not in a Map. An MV3
 * service worker is shut down whenever it goes idle for ~30s, and opening 20
 * tabs takes longer than that — in-memory state would be gone by the time the
 * later tabs finish booting and ask for their job.
 */

const MAX_TABS = 20;
const DOLA_HOST = /^https:\/\/(www\.)?dola\.com\//i;

const JOB_PREFIX = "job_";
const jobKey = (tabId) => `${JOB_PREFIX}${tabId}`;

function isDolaUrl(url) {
  return typeof url === "string" && DOLA_HOST.test(url);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setJob(tabId, job) {
  await chrome.storage.session.set({ [jobKey(tabId)]: job });
}

// Read and delete in one step: a job is meant to be applied exactly once.
async function takeJob(tabId) {
  const key = jobKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const job = stored[key] || null;
  if (job) await chrome.storage.session.remove(key);
  return job;
}

async function duplicateTabs({ sourceTabId, count, applySettings, skill }) {
  const source = await chrome.tabs.get(sourceTabId);

  if (!isDolaUrl(source.url)) {
    return { ok: false, error: "This tab is not dola.com. Open dola.com/chat first." };
  }

  const safeCount = Math.max(1, Math.min(MAX_TABS, Number(count) || 1));
  const created = [];

  for (let i = 0; i < safeCount; i++) {
    const tab = await chrome.tabs.create({
      url: source.url,
      windowId: source.windowId,
      index: source.index + 1 + i,
      active: false
    });

    // Written before the stagger, so a shutdown mid-batch cannot lose the job
    // for a tab that already exists.
    if (applySettings) {
      await setJob(tab.id, {
        pro: true,
        skill: skill || null,
        createdAt: Date.now()
      });
    }

    created.push(tab.id);
    // Stagger so Dola's app has room to boot in each tab.
    await wait(450);
  }

  return { ok: true, count: created.length, tabIds: created };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "DUPLICATE_TABS") {
    duplicateTabs(msg.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // async
  }

  // A freshly opened tab asking: "was I created by the extension?"
  if (msg.type === "GET_JOB") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ job: null });
      return false;
    }
    takeJob(tabId)
      .then((job) => sendResponse({ job }))
      .catch(() => sendResponse({ job: null }));
    return true; // async
  }

  if (msg.type === "JOB_RESULT") {
    // Kept for debugging; visible in the service worker console.
    console.log("[Dola Multi-Tab] tab result:", sender.tab && sender.tab.id, msg.payload);
    sendResponse({ ok: true });
    return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(jobKey(tabId));
});
