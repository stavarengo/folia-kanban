#!/usr/bin/env node
// Enforces the waiver lifecycle for tracking/waivers/ (spec §13.7 / README rules 5-6).
//
// Reads every tracking/waivers/*.md except _template.md and README.md, parses the
// Status and Expiry-date fields from the waiver table, and:
//   - prints each active waiver with its expiry and days remaining;
//   - fails (exit 1) if any non-resolved waiver has an expiry date in the past
//     (EXPIRED) — an expired waiver blocks merge;
//   - fails (exit 1) if a waiver is missing its Status or Expiry field
//     (malformed — a waiver must not dodge the check by omitting fields).
// Zero waiver files is fine (exit 0).
//
// Scope note: this check enforces *expiry + status presence/validity* only. It does
// not validate the Owner or Scope fields.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const waiversDir = join(root, "tracking", "waivers");

const SKIP = new Set(["_template.md", "README.md"]);

// Today as a date-only UTC instant, so time-of-day never flaps the comparison.
const now = new Date();
const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseStatus(text) {
  // Anchor on the bold table label so a stray "STATUS" in prose (e.g. the
  // DS-A11Y-STATUS-8 rule id) can never be mistaken for the Status field.
  const m = text.match(/\*\*Status\*\*[^\n]*?\b(active|expired|retired)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function parseExpiry(text) {
  // Match the bold Expiry label, then pull the first YYYY-MM-DD on that line.
  // Tolerates suffixes like "(review)" and "(required — ...)".
  const m = text.match(/\*\*Expiry[^\n]*?(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toUtcMidnight(isoDate) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

if (!existsSync(waiversDir)) {
  console.log("check-waivers: OK (no waivers directory)");
  process.exit(0);
}

const files = readdirSync(waiversDir)
  .filter((f) => f.endsWith(".md") && !SKIP.has(f))
  .sort();

if (files.length === 0) {
  console.log("check-waivers: OK (no waivers)");
  process.exit(0);
}

const malformed = [];
const expired = [];
const active = [];

for (const file of files) {
  const text = readFileSync(join(waiversDir, file), "utf8");
  const status = parseStatus(text);
  const expiry = parseExpiry(text);

  if (!status || !expiry) {
    const missing = [!status && "Status", !expiry && "Expiry"].filter(Boolean).join(" + ");
    malformed.push({ file, missing });
    continue;
  }

  const daysRemaining = Math.round((toUtcMidnight(expiry) - today) / MS_PER_DAY);
  const entry = { file, status, expiry, daysRemaining };

  // A "retired" waiver is resolved and no longer enforced. Anything else
  // (active, expired, or any unexpected state) is held to its expiry date.
  if (status === "retired") continue;

  if (toUtcMidnight(expiry) < today) {
    expired.push(entry);
  } else {
    active.push(entry);
  }
}

if (active.length) {
  console.log(`check-waivers: ${active.length} active waiver(s):`);
  for (const w of active) {
    console.log(
      `  - ${w.file} (status: ${w.status}, expiry: ${w.expiry}, ${w.daysRemaining} day(s) remaining)`,
    );
  }
}

if (expired.length || malformed.length) {
  console.error("check-waivers: FAIL");
  for (const w of expired) {
    console.error(
      `  - EXPIRED: ${w.file} (status: ${w.status}, expiry: ${w.expiry}, ${-w.daysRemaining} day(s) past due) — blocks merge (§13.7)`,
    );
  }
  for (const w of malformed) {
    console.error(
      `  - MALFORMED: ${w.file} (missing ${w.missing} field) — a waiver must declare Status and Expiry`,
    );
  }
  process.exit(1);
}

console.log(`check-waivers: OK (${active.length} active, all within expiry)`);
process.exit(0);
