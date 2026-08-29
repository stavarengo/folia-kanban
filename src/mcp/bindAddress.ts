// What counts as an address the MCP server may bind to, and which browser origins that choice
// implies. Pure string work, no Node and no Obsidian, so the settings tab can validate what the
// user typed and the transport can police an `Origin` header against the same rules.
//
// The address is a user-facing choice: `127.0.0.1` keeps the server on this machine, `0.0.0.0`
// puts it on every network this machine is on. Only literals and `localhost` are accepted. A name
// that has to be resolved is refused, because "an address valid on this machine" is a fact about
// the machine's interfaces, and a name that resolves elsewhere today may resolve somewhere else
// tomorrow.
//
// Accepted here means "the user could have meant this", not "this machine has it". The bind itself
// is what settles that, and it says so in a notice — the same path a taken port already takes.

/** Where the server binds unless the user says otherwise: this machine and nothing else. */
export const MCP_DEFAULT_BIND_ADDRESS = "127.0.0.1";

/** A dotted quad, rejecting leading zeros — `010.0.0.1` is read as octal by some resolvers and as
 *  decimal by others, so it is not an address anybody should be allowed to mean two things by. */
const IPV4_OCTET = /^(0|[1-9][0-9]{0,2})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

function isIpv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  return octets.every((o) => IPV4_OCTET.test(o) && Number(o) <= 255);
}

/** One IPv6 address as canonical hex groups, or `null` when any group is not one.
 *
 *  An embedded IPv4 tail (`::ffff:192.168.1.5`) is refused rather than parsed. It is a second
 *  spelling of an address that already has one, and one of its spellings is a trap: `::ffff:0.0.0.0`
 *  reads as a specific address here while Node binds it as the IPv4 wildcard, which would put the
 *  vault on every interface while the setting, the warning and the origin rule all said otherwise. */
function ipv6Groups(parts: string[]): string[] | null {
  const groups: string[] = [];
  for (const part of parts) {
    if (!IPV6_GROUP.test(part)) return null;
    groups.push(part.replace(/^0+(?=.)/, ""));
  }
  return groups;
}

/** The eight canonical groups a `::` address expands to, or `null` when either side is not one. */
function compressedIpv6(head: string, tail: string): string | null {
  const left = head === "" ? [] : ipv6Groups(head.split(":"));
  const right = tail === "" ? [] : ipv6Groups(tail.split(":"));
  if (left === null || right === null) return null;
  // `::` stands for at least one zero group, so the written groups can never add up to eight.
  if (left.length + right.length > 7) return null;
  const zeros = new Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].join(":");
}

/**
 * An IPv6 address as its eight canonical groups joined by `:`, or `null` when it is not one.
 *
 * Canonical rather than literal so two spellings of the same address compare equal: what the user
 * typed into the setting is never run through a URL parser, while an `Origin` header's hostname
 * always is, and `::1` and `[0:0:0:0:0:0:0:1]` have to mean the same thing on both sides.
 */
function canonicalIpv6(value: string): string | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 2) return compressedIpv6(halves[0] ?? "", halves[1] ?? "");
  const groups = ipv6Groups(value.split(":"));
  return groups?.length === 8 ? groups.join(":") : null;
}

/** A link-local IPv6 address is only bindable with the interface it is local to (`fe80::1%eth0`),
 *  so the zone is part of the address the user stores — and no part of any origin, which is why it
 *  comes off before anything is compared. */
const ZONE = /^[0-9a-z._-]+$/;

function withoutZone(address: string): string | null {
  const at = address.indexOf("%");
  if (at === -1) return address;
  const zone = address.slice(at + 1);
  return ZONE.test(zone) ? address.slice(0, at) : null;
}

/**
 * What a typed or parsed address means, with the noise taken off: surrounding whitespace, the
 * brackets a URL hostname carries around IPv6 (`new URL("http://[::1]").hostname` is `"[::1]"`),
 * and case. Not a validity check — {@link isBindAddress} is.
 */
export function normalizeBindAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

/** The address in a form two spellings of the same address share, or `null` when it is not an IP
 *  literal (`localhost` included: it is a name, however special a one). */
function canonicalIp(value: string): string | null {
  const address = withoutZone(normalizeBindAddress(value));
  if (address === null) return null;
  if (isIpv4(address)) return address;
  return canonicalIpv6(address);
}

/** Whether the user could plausibly have meant this as a bind address: an IP literal, or the one
 *  name that is guaranteed to be this machine. */
export function isBindAddress(value: string): boolean {
  const address = normalizeBindAddress(value);
  return address === "localhost" || canonicalIp(address) !== null;
}

/** Whether binding here keeps the server reachable from this machine only. */
export function isLoopbackBindAddress(value: string): boolean {
  if (normalizeBindAddress(value) === "localhost") return true;
  const address = canonicalIp(value);
  if (address === null) return false;
  // The whole of 127.0.0.0/8 is loopback, not just 127.0.0.1.
  return address.startsWith("127.") || address === "0:0:0:0:0:0:0:1";
}

/** Whether binding here means "every address this machine has", which is what `0.0.0.0` and `::`
 *  ask for — including the ones the machine picks up later, on a network it joins tomorrow. */
export function isWildcardBindAddress(value: string): boolean {
  const address = canonicalIp(value);
  return address === "0.0.0.0" || address === "0:0:0:0:0:0:0:0";
}

/**
 * Whether a request carrying this `Origin` may be answered by a server bound to `bindAddress`.
 *
 * A browser page on any origin can post to a server on the user's machine, so an origin the server
 * did not put there is checked before the request is allowed to mean anything. The rule:
 *
 * - No `Origin` at all is allowed. That is every MCP client; only browsers send one.
 * - A loopback origin is always allowed, whatever the bind is — a page served from this machine is
 *   as trusted as the machine.
 * - Any other origin must be an **IP literal**, and must be the address the server was bound to —
 *   or any literal at all when the bind is a wildcard, since the server was deliberately put on
 *   every address the machine has and cannot know which of them a legitimate page came in on.
 * - A DNS name is refused. This is the whole of the protection and it is worth stating plainly: an
 *   attacker's page reaches a server on your network by making a name they control resolve to your
 *   address, and the `Origin` it then sends is that name, never a literal. Requiring a literal
 *   defeats that without narrowing what a bind the user consciously chose can be reached from.
 * - `null` is an origin, not the absence of one: it is what a sandboxed iframe and a `file://` page
 *   send, so it is refused rather than waved through.
 *
 * The check is not what keeps another host out — the token is, and always was. It only keeps a page
 * in someone's browser from spending that host's access on the user's behalf.
 */
export function originAllowed(origin: string | undefined, bindAddress: string): boolean {
  if (typeof origin !== "string" || origin === "") return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (isLoopbackBindAddress(hostname)) return true;
  const host = canonicalIp(hostname);
  if (host === null) return false;
  if (isWildcardBindAddress(bindAddress)) return true;
  return host === canonicalIp(bindAddress);
}
