// Type shim for the plain-JS script under test: audit-raw-values.mjs has no declaration file of
// its own (it is a standalone CLI script, not part of the TS build), so tsc cannot infer these
// signatures from the .mjs source. Keep this in sync with the exports in ../scripts/audit-raw-values.mjs.
declare module "*/scripts/audit-raw-values.mjs" {
  export interface RawValueFinding {
    file: string;
    snippet: string;
    count: number;
  }

  export interface AllowlistEntry {
    file: string;
    snippet: string;
    count: unknown;
  }

  export function key(file: string, snippet: string): string;
  export function detect(scanSrcDir?: string, scanRoot?: string): RawValueFinding[];
  export function totalOccurrences(findings: readonly RawValueFinding[]): number;
  export function findNovel(
    findings: readonly RawValueFinding[],
    allowlist: readonly AllowlistEntry[],
  ): RawValueFinding[];
  export function writeAllowlist(findings: readonly RawValueFinding[], path?: string): void;
  export function readAllowlist(path?: string): AllowlistEntry[] | null;
}
