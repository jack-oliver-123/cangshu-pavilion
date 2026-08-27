import { lstat, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wikiRoot = resolve(scriptDir, "..");
const repositoryRoot = resolve(wikiRoot, "..", "..");
const target = resolve(repositoryRoot, "openspec");
const link = resolve(wikiRoot, "openspec");

function comparablePath(path) {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function pathStats(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const targetStats = await pathStats(target);
if (!targetStats?.isDirectory()) {
  throw new Error(`OpenSpec directory does not exist: ${target}`);
}

const targetRealPath = await realpath(target);
const linkStats = await pathStats(link);
if (linkStats) {
  let linkRealPath = null;
  try {
    linkRealPath = await realpath(link);
  } catch {
    // A broken link is safe to replace after lstat confirms it is a link.
  }

  if (linkRealPath && comparablePath(linkRealPath) === comparablePath(targetRealPath)) {
    console.log(`OpenSpec link is valid: ${link}`);
    process.exit(0);
  }

  if (!linkStats.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-link path at ${link}; move it manually first.`);
  }

  await unlink(link);
}

if (process.platform === "win32") {
  await symlink(targetRealPath, link, "junction");
} else {
  await symlink(relative(wikiRoot, targetRealPath), link, "dir");
}

const linkedRealPath = await realpath(link);
if (comparablePath(linkedRealPath) !== comparablePath(targetRealPath)) {
  throw new Error(`OpenSpec link resolved to an unexpected target: ${linkedRealPath}`);
}

console.log(`OpenSpec link created: ${link} -> ${targetRealPath}`);
