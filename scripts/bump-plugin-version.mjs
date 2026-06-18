import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const root = process.cwd();
const packagePath = resolve(root, "package.json");
const manifestPath = resolve(root, "manifest.json");
const versionsPath = resolve(root, "versions.json");

const packageJson = await readJson(packagePath);
const manifest = await readJson(manifestPath);
const versions = await readJson(versionsPath);

const version = process.argv[2] ?? packageJson.version;
const { minAppVersion } = manifest;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("version must be a non-empty string");
}

if (typeof minAppVersion !== "string" || minAppVersion.length === 0) {
  throw new Error("manifest.json minAppVersion must be a non-empty string");
}

packageJson.version = version;
manifest.version = version;
versions[version] = minAppVersion;

await Promise.all([
  writeJson(packagePath, packageJson),
  writeJson(manifestPath, manifest),
  writeJson(versionsPath, versions),
]);
