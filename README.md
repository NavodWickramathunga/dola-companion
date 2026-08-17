# Dola Multi-Tab

Opens up to 20 copies of your Dola chat tab and sets each one to **Pro** + a **Skill** you pick.
Created by Soori Academy, Sri Lanka.

## Install

1. Unzip this folder somewhere you will keep it (not the Downloads bin).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `dola-multitab` folder.
5. Pin the extension so the icon stays in the toolbar.

## Use

1. Open `https://www.dola.com/chat/` and sign in.
2. Click the extension icon.
   - On any other site the panel is greyed out and says *Open dola.com/chat to use this*.
3. Press **Load** once — it opens the Skill menu on your tab, reads the real skill names, and fills the dropdown. The list is saved for next time.
4. Pick your skill, choose how many tabs (1–20), press **Open tabs**.

Each new tab waits for Dola to finish loading, switches Fast → Pro, opens Skill, and picks your skill.
A small green pill in the bottom-right corner of each tab reports what it did.

## Limits worth knowing

- 20 tabs is a hard cap in both the slider and the background script.
- Tabs open 450 ms apart so Dola's app has room to boot in each one.
- Your Dola account plan still applies. The extension clicks the Pro button; it does not grant Pro.

## If a click misses

Dola is a React app and ships new builds often. Nothing here depends on a fixed CSS class —
every control is found by its visible label. If Dola renames a button, open `content.js` and
edit the words at the top:

```js
const LABELS = {
  pro:   ["pro"],
  fast:  ["fast"],
  skill: ["skill", "skills"]
};
```

If the app is slow to load on your connection, raise `bootDelay` in the same file
(2500 ms by default).

To see what happened in a tab: right-click the page → Inspect → Console.
For the tab-opening side: `chrome://extensions` → **service worker** under this extension.
