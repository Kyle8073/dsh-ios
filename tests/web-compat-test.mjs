import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function loadSource() {
  if (process.argv[2]) return fs.readFileSync(process.argv[2], 'utf8');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-compat-'));
  try {
    const executable = path.join(temp, 'export-script');
    const source = '#include <stdio.h>\n#include "DSHWebCompat.h"\n' +
      'int main(void) { return fputs(DSHWebCompatSource, stdout) == EOF; }\n';
    execFileSync(process.env.CC || 'cc',
      ['-I', path.resolve('app'), '-x', 'c', '-', '-o', executable],
      { input: source });
    return execFileSync(executable, { encoding: 'utf8' });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const source = loadSource();
const savedAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
const savedTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
const run = () => vm.runInThisContext(source, { filename: 'DSHWebCompat.js' });
const restore = (name, descriptor) => descriptor
  ? Object.defineProperty(AbortSignal, name, descriptor)
  : delete AbortSignal[name];

try {
  const nativeAny = AbortSignal.any;
  const nativeTimeout = AbortSignal.timeout;
  run();
  assert.equal(AbortSignal.any, nativeAny, 'must preserve native any()');
  assert.equal(AbortSignal.timeout, nativeTimeout, 'must preserve native timeout()');

  delete AbortSignal.any;
  run();
  assert.equal(typeof AbortSignal.any, 'function', 'legacy browser needs any()');
  assert.equal(AbortSignal.timeout, nativeTimeout, 'existing timeout() must remain untouched');
  const ios16Signal = new AbortController();
  const ios16Request = AbortSignal.any([AbortSignal.timeout(100), ios16Signal.signal]);
  ios16Signal.abort('cancelled');
  assert.equal(ios16Request.reason, 'cancelled');

  delete AbortSignal.any;
  delete AbortSignal.timeout;
  run();
  assert.equal(typeof AbortSignal.any, 'function', 'legacy browser needs any()');
  assert.equal(typeof AbortSignal.timeout, 'function', 'legacy browser needs timeout()');

  const first = new AbortController();
  const second = new AbortController();
  const combined = AbortSignal.any([first.signal, second.signal]);
  const reason = new Error('cancelled by user');
  second.abort(reason);
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, reason);
  assert.equal(first.signal.aborted, false);

  const already = new AbortController();
  already.abort('already cancelled');
  assert.equal(AbortSignal.any([already.signal]).reason, 'already cancelled');
  assert.equal(AbortSignal.any([]).aborted, false);
  assert.throws(() => AbortSignal.any([null]), TypeError);
  assert.throws(() => AbortSignal.timeout(-1), RangeError);
  assert.throws(() => AbortSignal.timeout('10'), TypeError);

  const timeout = AbortSignal.timeout(10);
  await once(timeout, 'abort');
  assert.equal(timeout.reason.name, 'TimeoutError');

  const server = http.createServer((req, res) => {
    if (req.url === '/slow') setTimeout(() => res.end('slow'), 150);
    else res.end('workspace listing');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([AbortSignal.timeout(1000), controller.signal]);
    assert.equal(await (await fetch(origin, { signal: requestSignal })).text(), 'workspace listing');
    const short = AbortSignal.any([AbortSignal.timeout(10), new AbortController().signal]);
    await assert.rejects(fetch(origin + '/slow', { signal: short }), e => e.name === 'TimeoutError');
  } finally {
    server.closeAllConnections();
    server.close();
  }
  console.log('Web compatibility checks passed');
} finally {
  restore('any', savedAny);
  restore('timeout', savedTimeout);
}
