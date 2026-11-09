# Node-RED cassette migration record

Status: applied with owner authorization in
`16f04dc390c9d779a3ac840c488ef4b508bb0e81` on November 9, 2026. The original
proposal and fixture remain in parent commit
`fe4c9d8256fde8b91f39cd815ef3ce0f29c9ca88`. Verification was offline, without API
credentials or network recording. The exit-status correction is separate:
replay failures now log their error and exit 1.

## Applied change

Only `request_hash` on lines 2 and 4 of `cassettes/node-red-flow.jsonl` changed.
Both are successful `openai.responses.create` recordings with
`text.format = {"type":"json_object"}`. Every other byte, entry order, newline,
result, preview, timestamp, and metadata field was preserved.

| JSONL line | Old request hash                                                   | Applied request hash                                               |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 2          | `9646ad9ad1e3d9f7a1114ff1f3b17c8dcfa95c737ff12f44a0ba8660c32c3d07` | `9a4368863dc7201b1ba030df979c017374c10fc096f22ac7deb7f904b1c3d6c7` |
| 4          | `54fb6c8d4e59e490a7f78dfc7ca92a69be4951f9804d482cfc0b5c15491fddd2` | `2e797c09e1556dcf17574ca45107373918ce0263e3012a4fa9c8b998ca6dc077` |

Original whole-file SHA-256:
`c6820e157b074c14a0e9b7d03a89e51722b571d1d08cb9febeae126895f0550c`.

Applied whole-file SHA-256 after exactly these two replacements:
`eef0e5cc3820f2a3aacd01178d8f066059b8454a70ffd3b1e921266199ede8b4`.

Lines 1 and 3 are historical error entries and remain unchanged. Line 5 is the
successful deployment recording and also remains unchanged. Re-keying line 2
does not turn the associated historical deployment failure into a success.
The current example requests line 4 and then replays line 5.

## Evidence and limits

- The original fixture bytes match its first Git version at
  `2b61e2edb4d622754b45fe07a8c2eef359685a2d`, the pre-fix baseline
  `f977ee70bc38e95fc94193485619cfca34a3b365`, and the identity-fix commit
  `7500735a570fa673c938c65258c28bbadebf84a2`.
- `src/cassette.ts` is identical between the fixture's first Git version and
  the pre-fix baseline. The producer uses the default strict identity profile
  and full argument-tuple preview. The later example change before `7500735`
  was a TypeScript cast, not a runtime identity or preview change.
- Each candidate preview has one argument with exactly `model`, `input`, and
  `text`. The preview has no redaction marker and applying the historical
  redactor leaves it unchanged. Each response is completed, has no response
  error, contains parseable JSON output, and independently stores matching
  `result.text.format` metadata.
- Executing the actual historical identity, serializer, and SHA-256 functions
  on each preview reproduces its stored hash exactly. Executing the functions
  from `7500735` produces the applied hashes. Removing the newly included
  `text` field from each new identity gives the historical identity exactly.
- A scratch candidate changed only the two hash strings. All five lookup keys
  remain distinct. Both candidate Responses entries replayed their exact saved
  results, with two hits and zero recorded calls. Both original entries missed
  under the new identity implementation.
- Running the real example against that isolated candidate exited 0, emitted
  no stderr, reported an active deployment and 343 saved-token metadata, and
  did not execute the deployment function. No candidate or original fixture
  changed during replay. These are offline observations, not live model or
  cost-savings measurements.

This supports a bounded re-keying of these trusted demo fixtures. Historical
hash equality proves correspondence to the old normalized request identity;
it cannot authenticate `text.format`, because that field was omitted from the
old identity. The full preview and matching saved response metadata supply
that additional evidence. They are not independent provider attestation.
Absence of redaction markers does not prove that nobody altered a preview
before it entered Git. Do not generalize this proposal to incomplete,
redacted, conflicting, or untrusted recordings.

## Reproducible verification of the applied migration

Run from the repository root using an installed Node runtime, the existing
npm dependencies, and Git history containing the commits named below. This
command reads the original fixture from Git, reconstructs the migrated bytes
in memory, and compares them with the current file. It never writes a fixture.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const oldRef = 'f977ee70bc38e95fc94193485619cfca34a3b365';
const newRef = '7500735a570fa673c938c65258c28bbadebf84a2';
const migrationParent = 'fe4c9d8256fde8b91f39cd815ef3ce0f29c9ca88';
const origin = '2b61e2edb4d622754b45fe07a8c2eef359685a2d';
const path = 'cassettes/node-red-flow.jsonl';
const digest = value => createHash('sha256').update(value).digest('hex');
const gitFile = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`]);
async function load(ref) {
  const source = gitFile(ref, 'src/cassette.ts').toString('utf8');
  const js = ts.transpileModule(source +
    '\nexport { stableSerialize, sha256Hex, defaultRedactValue };\n', {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const old = await load(oldRef), current = await load(newRef);
assert.deepEqual(gitFile(origin, 'src/cassette.ts'), gitFile(oldRef, 'src/cassette.ts'));
assert.deepEqual(readFileSync('src/cassette.ts'), gitFile(newRef, 'src/cassette.ts'));
const original = gitFile(migrationParent, path);
assert.equal(digest(original), 'c6820e157b074c14a0e9b7d03a89e51722b571d1d08cb9febeae126895f0550c');
for (const ref of [origin, oldRef, newRef]) assert.deepEqual(original, gitFile(ref, path));
const lines = original.toString('utf8').split('\n');
assert.equal(lines.length, 6);
assert.equal(lines.at(-1), '');
const proposed = lines.slice();
for (const line of [2, 4]) {
  const entry = JSON.parse(lines[line - 1]);
  assert.equal(entry.call_name, 'openai.responses.create');
  assert.equal(entry.error, undefined);
  assert.equal(entry.args_preview.length, 1);
  const request = entry.args_preview[0];
  assert.deepEqual(Object.keys(request).sort(), ['input', 'model', 'text']);
  assert.deepEqual(request.text, { format: { type: 'json_object' } });
  assert.ok(!JSON.stringify(request).includes('[REDACTED]'));
  assert.deepEqual(old.defaultRedactValue(request), request);
  assert.equal(entry.result.status, 'completed');
  assert.equal(entry.result.error, null);
  assert.deepEqual(entry.result.text.format, request.text.format);
  JSON.parse(entry.result.output_text);
  const hash = api => api.sha256Hex(api.stableSerialize(
    api.createOpenAIResponsesRequestIdentity(request, { hashProfile: 'strict' })));
  const before = hash(old), after = hash(current);
  assert.equal(before, entry.request_hash);
  assert.notEqual(before, after);
  const { text, ...withoutText } = current.createOpenAIResponsesRequestIdentity(request);
  assert.deepEqual(text, request.text);
  assert.deepEqual(withoutText, old.createOpenAIResponsesRequestIdentity(request));
  const token = `"request_hash":"${before}"`;
  assert.equal(lines[line - 1].split(token).length, 2);
  proposed[line - 1] = lines[line - 1].replace(token, `"request_hash":"${after}"`);
  assert.deepEqual({ ...JSON.parse(proposed[line - 1]), request_hash: before }, entry);
  console.log(JSON.stringify({ line, verifiedOldHash: before, appliedHash: after }));
}
for (const line of [1, 3, 5]) assert.equal(proposed[line - 1], lines[line - 1]);
const keys = proposed.slice(0, -1).map(line => {
  const e = JSON.parse(line); return `${e.call_name}::${e.request_hash}`;
});
assert.equal(new Set(keys).size, 5);
assert.equal(digest(proposed.join('\n')), 'eef0e5cc3820f2a3aacd01178d8f066059b8454a70ffd3b1e921266199ede8b4');
assert.deepEqual(readFileSync(path), Buffer.from(proposed.join('\n'), 'utf8'));
console.log('Verified both mappings, the applied checksum, and exact current bytes; no files written.');
NODE
```

For release verification, run the read-only audit above and inspect the
fixture diff against `fe4c9d8`. Re-run
`npm test`, `npm run lint`, `./node_modules/.bin/tsc --noEmit`, and
`npm run nodered:replay` with API credentials unset. Require replay exit 0,
empty stderr, an active saved deployment, and no recorded calls or live side
effects. Preserve the two direct response replay checks as well as the full
example check: the current example alone exercises only line 4.

Any changed precondition, missing preview, conflicting format metadata, failed
old-hash check, or unexpected duplicate lookup key invalidates this audit.
Do not guess replacement values or invoke a paid recording API.

## Rollback

The original fixture remains in `fe4c9d8`; retain that commit and the
before/after checksums above. To roll back, first require the applied checksum,
reverse only the two `request_hash` replacements, and require the original
checksum. Review that
diff and record it in a new local commit; do not reset or rewrite history.
Keep `7500735` and the exit-status correction intact. A fixture-only rollback
will deliberately restore the replay miss and exit 1 under the new identity
contract, so it also withdraws successful Node-RED release verification.

## Separate response-identity follow-up: text.verbosity

Observed locally: otherwise identical synthetic requests with
`text.verbosity = 'low'` and `'high'` currently produce equal identities in both
strict and lenient profiles. No verbosity handling was added in this change.

For a separate task, verify the applicable SDK/API contract, decide profile and
omitted/default-value semantics explicitly, write failing regressions for
material verbosity differences, preserve key-order invariance, and audit hash
compatibility. The pinned SDK does not currently declare this field in
`ResponseTextConfig`; any SDK change requires its own scope decision. Neither
of the two migrated requests contains `text.verbosity`; no value was inferred
or inserted during this migration.
