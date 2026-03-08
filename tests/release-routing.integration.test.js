const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createApp } = require('../src/index');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-routing-'));
  const releaseId = '20260308';
  const releaseDir = path.join(tmpDir, releaseId);
  const assetsDir = path.join(releaseDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'release-meta.json'), JSON.stringify({ activeRelease: releaseId }), 'utf8');
  fs.writeFileSync(
    path.join(releaseDir, 'index.html'),
    '<html><script src="/releases/stable/assets/main.abc123.js"></script>release index</html>',
    'utf8'
  );
  fs.writeFileSync(path.join(assetsDir, 'main.abc123.js'), 'console.log("ok")', 'utf8');

  process.env.FRONTEND_RELEASES_DIR = tmpDir;
  process.env.FRONTEND_RELEASE_META_PATH = path.join(tmpDir, 'release-meta.json');

  const app = createApp();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const rootRes = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.strictEqual(rootRes.status, 302);
    assert.strictEqual(rootRes.headers.get('location'), `/releases/${releaseId}/`);

    const indexRes = await fetch(`${baseUrl}/releases/${releaseId}/index.html`);
    assert.strictEqual(indexRes.status, 200);
    assert.strictEqual(indexRes.headers.get('cache-control'), 'no-store, must-revalidate');
    const indexBody = await indexRes.text();
    assert.ok(indexBody.includes(`/releases/${releaseId}/assets/main.abc123.js`));

    const assetRes = await fetch(`${baseUrl}/releases/${releaseId}/assets/main.abc123.js`);
    assert.strictEqual(assetRes.status, 200);
    assert.strictEqual(assetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const fallbackRes = await fetch(`${baseUrl}/releases/${releaseId}/orders/123`);
    assert.strictEqual(fallbackRes.status, 200);
    const fallbackBody = await fallbackRes.text();
    assert.ok(fallbackBody.includes('release index'));

    const missingAssetRes = await fetch(`${baseUrl}/releases/${releaseId}/assets/missing.js`);
    assert.strictEqual(missingAssetRes.status, 404);

    const releaseMetaRes = await fetch(`${baseUrl}/release-meta.json`);
    assert.strictEqual(releaseMetaRes.status, 200);
    assert.strictEqual(releaseMetaRes.headers.get('cache-control'), 'no-store, must-revalidate');

    console.log('release-routing integration test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
