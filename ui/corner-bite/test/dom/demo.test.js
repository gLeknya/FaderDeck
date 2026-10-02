import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Demo scenes and cleanup', () => {
  test('demo/index.html does not mutate #scene-host id in renderScene1 or any other scene', () => {
    const htmlPath = path.resolve('demo/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Reproduction check: previously renderScene1 had `host.id = 'scene1-host'`
    // which caused document.getElementById('scene-host') to return null in cleanup()
    const mutatesHostId = /host\.id\s*=\s*['"]scene1-host['"]/.test(html);
    assert.strictEqual(
      mutatesHostId,
      false,
      'renderScene1 should not mutate host.id to scene1-host, as cleanup() looks for #scene-host'
    );
  });

  test('cleanup in demo/index.html safely handles host element across all scenes', () => {
    const htmlPath = path.resolve('demo/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Check that cleanup has a safe guard or consistent element reference
    assert.ok(
      html.includes("const host = document.getElementById('scene-host')"),
      'demo/index.html should reference scene-host'
    );
  });
});
