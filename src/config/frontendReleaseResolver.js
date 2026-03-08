const fs = require('fs');
const path = require('path');

const DEFAULT_RELEASES_DIR = path.resolve(process.cwd(), 'public/releases');

function getReleasesDir() {
  return path.resolve(process.env.FRONTEND_RELEASES_DIR || DEFAULT_RELEASES_DIR);
}

function getReleaseMetaPath() {
  return path.resolve(
    process.env.FRONTEND_RELEASE_META_PATH || path.join(getReleasesDir(), 'release-meta.json')
  );
}

function readReleaseMeta() {
  const releaseMetaPath = getReleaseMetaPath();
  try {
    const content = fs.readFileSync(releaseMetaPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function getActiveRelease() {
  const meta = readReleaseMeta();
  if (!meta || typeof meta !== 'object') return null;

  const candidates = [meta.activeRelease, meta.active_release, meta.release, meta.id];
  const activeRelease = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);

  return activeRelease ? activeRelease.trim() : null;
}

module.exports = {
  getActiveRelease,
  getReleaseMetaPath,
  getReleasesDir,
  readReleaseMeta
};
