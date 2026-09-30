// Runs axe-core's color-contrast rule inside a live Obsidian over CDP, because jsdom cannot compute
// contrast (test/a11y.axe.test.tsx turns the rule off for that reason). It needs an Obsidian that has
// this repository's `examples/` folder open as its vault with the plugin built into it
// (`pnpm dev:examplesVault`) and a remote-debugging port; AGENTS.md says how to start one.
//
//   pnpm contrast:live http://<host>:<port> [--verbose]
//
// For the default dark and light themes it measures the Feature Showcase board with no dialog open,
// then the card detail dialog alone (title trace expanded) for each card that shows a context chip;
// the board behind the dialog's backdrop is not measured twice. axe skips text
// scrolled out of view, so every scroll container is stepped through its range. Where axe cannot
// resolve the colours behind Folia's own text (a pseudo-element, a gradient, a colour it cannot
// parse), that text is measured from pixels instead and counts the same; Obsidian's own text is
// listed but not counted. docs/decisions.md, "Readable text beats the host's exact colour", has the
// method. `--verbose` also lists every node that passed.
//
// Exits non-zero on any failure except two documented exceptions, each printed as such:
// - in the light theme, an internal link Obsidian rendered into the dialog's description or
//   a comment (the same section of docs/decisions.md);
// - text in a column the board note fades, while it is faded ("A column the board note fades").
//   Each faded column is then measured again at its hover opacity, and that counts.
//
// The vault's theme setting is restored afterwards; `git checkout -- examples` undoes anything
// else.

/* global app, axe -- page globals: Obsidian's app, and the axe-core this script injects before page.evaluate runs. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const BOARD = "feature-showcase/Showcase Board.md";
// Lets theme and panel transitions finish, so axe reads the final colours rather than a blend.
const SETTLE_MS = 1000;
const RENDERED_MARKDOWN = ".folia-desc-rendered, .folia-comment-text";
const RENDERED_INTERNAL_LINK = `:is(${RENDERED_MARKDOWN}) a.internal-link`;
const HOST_EXCEPTION =
  'documented host exception (see docs/decisions.md, "Readable text beats the host\'s exact colour")';
const THEMES = [
  { name: "dark", id: "obsidian", bodyClass: "theme-dark" },
  { name: "light", id: "moonstone", bodyClass: "theme-light" },
];

const verbose = process.argv.includes("--verbose");
const endpoint =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.OBSIDIAN_DEBUG_URL;
if (!endpoint) {
  console.error("usage: pnpm contrast:live http://<host>:<port>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith("app://obsidian.md/index.html"));
if (!page) throw new Error(`no Obsidian vault window behind ${endpoint}`);

const vault = await page.evaluate(() => app.vault.getName());
if (vault !== "examples")
  throw new Error(`the open vault is "${vault}", not the repository's examples/`);
await page.evaluate(axeSource);

// The numbers are only claimed for Obsidian's own themes, so refuse anything that would change them.
const appearance = await page.evaluate(() => ({
  cssTheme: app.vault.getConfig("cssTheme") || "",
  accentColor: app.vault.getConfig("accentColor") || "",
  snippets: app.vault.getConfig("enabledCssSnippets") ?? [],
}));
if (appearance.cssTheme || appearance.accentColor || appearance.snippets.length)
  throw new Error(
    `measure with Obsidian's default appearance; this vault has ${JSON.stringify(appearance)}`,
  );

// A build does not reach a running Obsidian: reload the plugin and prove the live sheet is the built one.
const builtCss = readFileSync(
  new URL("../examples/.obsidian/plugins/folia-kanban/styles.css", import.meta.url),
  "utf8",
);
const liveCss = await page.evaluate(async () => {
  await app.plugins.disablePlugin("folia-kanban");
  await app.plugins.enablePlugin("folia-kanban");
  return [...document.querySelectorAll("style")]
    .map((s) => s.textContent)
    .filter((t) => t.includes(".folia-scope"));
});
if (!liveCss.includes(builtCss))
  throw new Error(
    "the running plugin's stylesheet is not the one in examples/; rebuild with `pnpm dev:examplesVault`",
  );

const version = await page.title();
const axeVersion = await page.evaluate(() => axe.version);
const originalTheme = await page.evaluate(() => app.vault.getConfig("theme"));

async function openBoard() {
  await page.evaluate(async (file) => {
    const [leaf = app.workspace.getLeaf(true), ...others] =
      app.workspace.getLeavesOfType("folia-kanban-view");
    for (const other of others) other.detach();
    await leaf.setViewState({ type: "empty" });
    await leaf.setViewState({ type: "folia-kanban-view", state: { file }, active: true });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    app.workspace.revealLeaf(leaf);
  }, BOARD);
  await page.waitForFunction(() =>
    app.workspace.activeLeaf?.view.containerEl.querySelector(".folia-card"),
  );
}

// Every card with a context chip, each opened in the detail panel in turn.
function contextCards() {
  return page.evaluate(() => {
    const root = app.workspace.activeLeaf.view.containerEl;
    const titles = [...root.querySelectorAll(".folia-card--has-context .folia-card-title")].map(
      (e) => e.textContent,
    );
    return [...new Set(titles)];
  });
}

// The detail panel is Obsidian's own Modal; Escape closes it, and nothing else may stay open when
// the board is measured, or its backdrop would sit over the board.
async function closeDetail() {
  while (await page.evaluate(() => Boolean(document.querySelector(".folia-detail-modal")))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

async function openCard(title) {
  await closeDetail();
  await page.evaluate((title) => {
    const root = app.workspace.activeLeaf.view.containerEl;
    [...root.querySelectorAll(".folia-card-title")].find((e) => e.textContent === title).click();
  }, title);
  await page.waitForFunction(
    (title) => document.querySelector(".folia-detail-title")?.textContent.includes(title),
    title,
  );
  await page.waitForFunction(() => document.querySelector(".folia-title-reason"));
  // Open the title trace too, so its rows are measured with the rest of the panel.
  await page.evaluate(() => document.querySelector(".folia-title-why").click());
  await page.waitForFunction(() => document.querySelector(".folia-title-trace"));
}

// "board" measures the board leaf with no dialog open; "detail" measures only the dialog, since the
// board behind its backdrop is covered and already measured on its own.
async function measure(scope) {
  // Nothing under the pointer, so no hover colour is measured as the resting one.
  await page.mouse.move(0, 0);
  return page.evaluate(
    async ({ RENDERED_MARKDOWN, RENDERED_INTERNAL_LINK, scope }) => {
      const modal = document.querySelector(".folia-detail-modal");
      if (scope === "board" && modal) throw new Error("the detail dialog is open over the board");
      if (scope === "detail" && !modal) throw new Error("the detail dialog is not open");
      const include = scope === "board" ? [app.workspace.activeLeaf.view.containerEl] : [modal];
      const canvas = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true });
      const rgba = (css) => {
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = css;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const channel = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const luminance = ([r, g, b]) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const contrast = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const hex = (c) =>
        "#" +
        c
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("");
      const frames = () =>
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const probe = document.head.appendChild(document.createElement("style"));
      probe.textContent =
        ".folia-contrast-probe, .folia-contrast-probe * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; transition: none !important; }";
      // Obsidian's own module, resolved inside the app window, not by this script.
      const remote = window.require("@electron/remote");
      const webContents = remote.getCurrentWebContents();
      const browserWindow = remote.getCurrentWindow();

      // axe skips text scrolled out of its container, so every scroll container is stepped through
      // its whole range and the findings are merged per element; a failure anywhere wins.
      const stops = (max, step) => {
        const list = [];
        for (let at = 0; at < max; at += step) list.push(at);
        return [...list, max];
      };
      async function scan(roots) {
        const found = new Map();
        found.checked = new Set();
        const collect = async () => {
          const result = await axe.run(roots, {
            runOnly: ["color-contrast"],
            elementRef: true,
          });
          for (const node of [...result.passes, ...result.violations, ...result.incomplete].flatMap(
            (rule) => rule.nodes,
          ))
            found.checked.add(node.element);
          for (const [kind, rules] of [
            ["violation", result.violations],
            ["incomplete", result.incomplete],
          ])
            for (const node of rules.flatMap((rule) => rule.nodes)) {
              const seen = found.get(node.element);
              if (!seen || (seen.kind === "incomplete" && kind === "violation"))
                found.set(node.element, { kind, node });
            }
        };
        const scrollers = roots
          .flatMap((root) => [root, ...root.querySelectorAll("*")])
          .filter((e) => {
            const style = getComputedStyle(e);
            return (
              (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(style.overflowX)) ||
              (e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(style.overflowY))
            );
          });
        await collect();
        for (const scroller of scrollers) {
          scroller.scrollIntoView({ block: "nearest", inline: "nearest" });
          const xs = stops(scroller.scrollWidth - scroller.clientWidth, scroller.clientWidth * 0.8);
          const ys = stops(
            scroller.scrollHeight - scroller.clientHeight,
            scroller.clientHeight * 0.8,
          );
          for (const x of xs)
            for (const y of ys) {
              scroller.scrollTo(x, y);
              await frames();
              await collect();
            }
          scroller.scrollTo(0, 0);
        }
        return found;
      }

      // A form control draws its own text, which has no text node on screen: its content box is
      // where the text sits (the padding holds a select's chevron).
      const contentRect = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        const px = (prop) => parseFloat(st[prop]) || 0;
        const left = r.left + px("borderLeftWidth") + px("paddingLeft");
        const top = r.top + px("borderTopWidth") + px("paddingTop");
        const right = r.right - px("borderRightWidth") - px("paddingRight");
        const bottom = r.bottom - px("borderBottomWidth") - px("paddingBottom");
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      };
      const textBox = (el) => {
        const rects = [];
        if (el.matches("select, input, textarea")) rects.push(contentRect(el));
        else {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            if (!text.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            rects.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
          }
        }
        if (!rects.length) return null;
        const x = Math.ceil(Math.max(0, Math.min(...rects.map((r) => r.left))));
        const y = Math.ceil(Math.max(0, Math.min(...rects.map((r) => r.top))));
        const right = Math.floor(Math.min(innerWidth, Math.max(...rects.map((r) => r.right))));
        const bottom = Math.floor(Math.min(innerHeight, Math.max(...rects.map((r) => r.bottom))));
        if (right - x < 1 || bottom - y < 1) return null;
        const top = document.elementFromPoint((x + right) / 2, (y + bottom) / 2);
        if (!top || !(top === el || el.contains(top))) return null;
        return { x, y, width: right - x, height: bottom - y };
      };

      async function fromPixels(el) {
        let box = textBox(el);
        for (const inline of ["center", "start", "end"]) {
          if (box) break;
          el.scrollIntoView({ block: "center", inline });
          await frames();
          box = textBox(el);
        }
        if (!box) return { unmeasured: "not visible on screen, even after scrolling it into view" };
        const style = getComputedStyle(el);
        const [r, g, b, alpha] = rgba(style.color);
        // Ancestor opacity is folded into the text's alpha and blended over the captured background,
        // which that opacity has already faded. The exact result would blend both over what lies
        // behind the faded ancestor; the two differ by (1 - opacity) times the gap between that
        // backdrop and the background, which is negligible at a revealed column's 0.95.
        let opacity = alpha;
        for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        // Proof each capture is a fresh frame: with the text hidden, the pixels must differ. An
        // unfocused window stops painting and hands back its last frame (AGENTS.md), so a pair that
        // does not differ is taken again after nudging the window's size, which forces a repaint.
        const capturePair = async () => {
          await frames();
          const shown = (await webContents.capturePage(box)).toBitmap();
          el.classList.add("folia-contrast-probe");
          try {
            await frames();
            return [shown, (await webContents.capturePage(box)).toBitmap()];
          } finally {
            el.classList.remove("folia-contrast-probe");
          }
        };
        let [withText, bitmap] = await capturePair();
        for (let attempt = 0; attempt < 3 && bitmap.equals(withText); attempt++) {
          const [width, height] = browserWindow.getSize();
          browserWindow.setSize(width + 1, height);
          await new Promise((r) => setTimeout(r, 300));
          browserWindow.setSize(width, height);
          await new Promise((r) => setTimeout(r, 1000));
          [withText, bitmap] = await capturePair();
        }
        if (bitmap.equals(withText)) return { unmeasured: "hiding its text changed no pixel" };
        // The background is what covers the text box, not a hairline that crosses it (a border, the
        // priority bar at a card's edge, anti-aliasing): colours under 5% of the box are ignored.
        const counts = new Map();
        for (let i = 0; i < bitmap.length; i += 4) {
          const key = (bitmap[i + 2] << 16) | (bitmap[i + 1] << 8) | bitmap[i];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        let worst = { ratio: Infinity };
        for (const [key, count] of counts) {
          if (count < (bitmap.length / 4) * 0.05) continue;
          const bg = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
          const fg = [r, g, b].map((v, k) => opacity * v + (1 - opacity) * bg[k]);
          const ratio = contrast(fg, bg);
          if (ratio < worst.ratio) worst = { ratio, fg, bg };
        }
        return {
          ratio: Math.round(worst.ratio * 100) / 100,
          fg: hex(worst.fg),
          bg: hex(worst.bg),
          required: large ? 3 : 4.5,
          size: `${size}px`,
        };
      }

      // A column the board note fades (`opacity` below 1) is exempt only while it is faded: not
      // hovered and not holding focus. Its revealed state is measured separately, and counts.
      const isFaded = (el) => {
        const column = el.closest(".folia-column.is-faded");
        return Boolean(
          column &&
          Number(getComputedStyle(column).opacity) < 1 &&
          !column.matches(":hover, :focus-within"),
        );
      };
      async function describe(found, revealed) {
        const nodes = [];
        nodes.checked = found.checked.size;
        for (const { kind, node } of found.values()) {
          const el = node.element;
          const data = node.any[0]?.data ?? {};
          const n = {
            target: node.target.join(" "),
            text: el?.textContent?.trim().slice(0, 40),
            folia: Boolean(el?.closest(".folia-scope") && !el.closest(RENDERED_MARKDOWN)),
            renderedLink: Boolean(el?.matches(RENDERED_INTERNAL_LINK)),
            hostLinkColor: el
              ? hex(rgba(getComputedStyle(el).getPropertyValue("--link-color")))
              : null,
            faded: !revealed && Boolean(el && isFaded(el)),
            reason: node.any[0]?.message,
          };
          if (kind === "violation")
            n.axe = {
              ratio: data.contrastRatio,
              fg: data.fgColor,
              bg: data.bgColor,
              size: data.fontSize,
            };
          else n.pixels = await fromPixels(el);
          nodes.push(n);
        }
        return nodes;
      }

      try {
        const nodes = await describe(await scan(include), false);
        const checked = nodes.checked;
        const revealed = [];
        let revealedChecked = 0;
        for (const column of include.flatMap((root) => [
          ...root.querySelectorAll(".folia-column.is-faded"),
        ])) {
          const hoverOpacity = getComputedStyle(column).getPropertyValue(
            "--folia-col-hover-opacity",
          );
          column.style.transition = "none";
          column.style.opacity = hoverOpacity.trim() || "1";
          try {
            column.scrollIntoView({ block: "nearest", inline: "center" });
            await frames();
            const found = await describe(await scan([column]), true);
            revealedChecked += found.checked;
            revealed.push(...found);
          } finally {
            column.style.removeProperty("opacity");
            column.style.removeProperty("transition");
          }
        }
        return { nodes, revealed, checked, revealedChecked };
      } finally {
        probe.remove();
      }
    },
    { RENDERED_MARKDOWN, RENDERED_INTERNAL_LINK, scope },
  );
}

const rows = [];
try {
  for (const theme of THEMES) {
    await closeDetail();
    await page.evaluate((id) => app.changeTheme(id), theme.id);
    await page.waitForFunction((cls) => document.body.classList.contains(cls), theme.bodyClass);
    await openBoard();
    await page.waitForTimeout(SETTLE_MS);
    rows.push({ surface: "board", theme: theme.name, ...(await measure("board")) });
    for (const title of await contextCards()) {
      await openCard(title);
      await page.waitForTimeout(SETTLE_MS);
      rows.push({
        surface: `detail dialog on "${title}"`,
        theme: theme.name,
        ...(await measure("detail")),
      });
    }
    await closeDetail();
  }
} finally {
  await closeDetail();
  await page.evaluate((id) => app.changeTheme(id), originalTheme);
  await browser.close();
}

const FADED_EXCEPTION =
  'documented faded-column exception (see docs/decisions.md, "A column the board note fades")';
const fails = (n) => (n.axe ? true : n.pixels.unmeasured || n.pixels.ratio < n.pixels.required);
// The host exception is only as wide as what was measured: Obsidian's own link colour, drawn
// unchanged, no worse than the 4.25:1 it measured on the detail dialog's #ffffff.
const HOST_EXCEPTION_FLOOR = 4.2;
const isHostException = (row, n) =>
  row.theme === "light" &&
  n.renderedLink &&
  n.axe?.fg === n.hostLinkColor &&
  n.axe.ratio >= HOST_EXCEPTION_FLOOR;
const exception = (row, n) =>
  isHostException(row, n) ? HOST_EXCEPTION : n.faded ? FADED_EXCEPTION : null;
const describe = (n) =>
  n.axe
    ? `${n.target} "${n.text}" ${n.axe.ratio}:1 (${n.axe.fg} on ${n.axe.bg}, ${n.axe.size})`
    : n.pixels.unmeasured
      ? `${n.target} "${n.text}" ${n.pixels.unmeasured}`
      : `${n.target} "${n.text}" ${n.pixels.ratio}:1 from pixels (${n.pixels.fg} on ${n.pixels.bg}, ${n.pixels.size}, needs ${n.pixels.required}:1)`;

console.log(
  `${version}, axe-core ${axeVersion}, color-contrast; default themes, default accent, no CSS snippets\n`,
);
let failed = false;
for (const row of rows) {
  const counted = [...row.nodes.filter((n) => n.folia || n.axe), ...row.revealed];
  const failures = counted.filter((n) => fails(n) && !exception(row, n));
  const excepted = counted.filter((n) => fails(n) && exception(row, n));
  const pixelMeasured = row.nodes.filter((n) => n.folia && n.pixels).length;
  const host = row.nodes.filter((n) => !n.folia && !n.axe);
  failed ||= failures.length > 0;
  console.log(
    `${row.surface}, ${row.theme}: ${failures.length} failures, ${excepted.length} documented exceptions ` +
      `(${row.checked} text nodes checked, ${pixelMeasured} of them Folia's measured from pixels because axe could not; ` +
      `${row.revealedChecked} re-checked in faded columns revealed; ${host.length} host nodes listed, not counted)`,
  );
  for (const n of failures)
    console.log(`  fail${row.revealed.includes(n) ? " (revealed)" : ""}: ${describe(n)}`);
  for (const n of excepted) console.log(`  ${exception(row, n)}: ${describe(n)}`);
  for (const n of host) console.log(`  host, not counted: ${describe(n)} [axe: ${n.reason}]`);
  if (verbose)
    for (const n of counted.filter((n) => !fails(n)))
      console.log(
        `  pass${row.revealed.includes(n) ? " (revealed)" : ""}: ${describe(n)} [axe: ${n.reason}]`,
      );
}
process.exit(failed ? 1 : 0);
