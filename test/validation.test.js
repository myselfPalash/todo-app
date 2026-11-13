import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DESCRIPTION,
  validateCreate,
  validatePatch,
  validateDescription,
  parseId,
} from '../src/validation.js';

function assertRejected(result, pattern, label = 'expected rejection') {
  assert.equal(result.ok, false, `${label}: got ${JSON.stringify(result)}`);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
  if (pattern) assert.match(result.message, pattern);
}

describe('MAX_DESCRIPTION', () => {
  it('is 200', () => {
    assert.equal(MAX_DESCRIPTION, 200);
  });
});

describe('validateCreate', () => {
  it('trims the description (AC1)', () => {
    assert.deepEqual(validateCreate({ description: '  Buy milk  ' }), {
      ok: true,
      value: { description: 'Buy milk' },
    });
  });

  it('rejects empty and whitespace-only descriptions', () => {
    assertRejected(validateCreate({ description: '' }), /empty/i);
    assertRejected(validateCreate({ description: '   ' }), /empty/i);
    assertRejected(validateCreate({ description: ' \t\n ' }), /empty/i);
  });

  it('accepts exactly 200 code points and rejects 201', () => {
    assert.equal(validateCreate({ description: 'a'.repeat(200) }).ok, true);
    assertRejected(validateCreate({ description: 'a'.repeat(201) }), /200/);
  });

  it('counts code points, not UTF-16 units (emoji)', () => {
    const ok = validateCreate({ description: '😀'.repeat(200) });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.description, '😀'.repeat(200));
    assertRejected(validateCreate({ description: '😀'.repeat(201) }), /200/);
  });

  it('applies the length limit after trimming', () => {
    const r = validateCreate({ description: `  ${'b'.repeat(200)}  ` });
    assert.equal(r.ok, true);
    assert.equal(r.value.description.length, 200);
  });

  it('rejects C0 control characters, DEL, C1 controls and line/paragraph separators', () => {
    const forbidden = [
      '\u0000', '\u0001', '\u0007', '\t', '\n', '\r', '\u001B', '\u001F',
      '\u007F',
      '\u0080', '\u0085', '\u009F',
      '\u2028', '\u2029',
    ];
    for (const ch of forbidden) {
      const code = ch.codePointAt(0).toString(16);
      assertRejected(
        validateCreate({ description: `a${ch}b` }),
        undefined,
        `U+${code} should be rejected`
      );
    }
  });

  it('accepts ordinary non-ASCII text right outside the forbidden ranges', () => {
    for (const ch of ['\u00A0', '\u00E9', '\u2027', '\u202A']) {
      assert.equal(validateCreate({ description: `a${ch}b` }).ok, true);
    }
  });

  it('rejects lone surrogates (non-well-formed strings)', () => {
    assertRejected(validateCreate({ description: 'abc\uD800' }), /unicode/i);
    assertRejected(validateCreate({ description: '\uDC00abc' }), /unicode/i);
  });

  it('rejects non-string descriptions', () => {
    for (const description of [123, true, null, [], {}, ['x']]) {
      assertRejected(validateCreate({ description }), /string/i);
    }
  });

  it('requires description', () => {
    assertRejected(validateCreate({}), /required/i);
  });

  it('rejects unknown fields, including id, createdAt and completed', () => {
    assertRejected(validateCreate({ description: 'x', extra: 1 }), /unknown field/i);
    assertRejected(validateCreate({ description: 'x', id: 5 }), /unknown field/i);
    assertRejected(validateCreate({ description: 'x', createdAt: 'now' }), /unknown field/i);
    assertRejected(validateCreate({ description: 'x', completed: true }), /unknown field/i);
  });

  it('rejects bodies that are not plain objects', () => {
    for (const body of [null, undefined, [], ['x'], 1, 'text', true]) {
      assertRejected(validateCreate(body), /JSON object/);
    }
  });

  it('stores SQL-looking and HTML-looking text unchanged', () => {
    for (const s of ["x'); DROP TABLE tasks;--", '<img src=x onerror=alert(1)>']) {
      assert.deepEqual(validateCreate({ description: s }), { ok: true, value: { description: s } });
    }
  });
});

describe('validatePatch', () => {
  it('accepts description only (trimmed)', () => {
    assert.deepEqual(validatePatch({ description: '  New  ' }), {
      ok: true,
      value: { description: 'New' },
    });
  });

  it('accepts completed only, both true and false', () => {
    assert.deepEqual(validatePatch({ completed: true }), { ok: true, value: { completed: true } });
    assert.deepEqual(validatePatch({ completed: false }), { ok: true, value: { completed: false } });
  });

  it('accepts both fields', () => {
    assert.deepEqual(validatePatch({ description: 'a', completed: true }), {
      ok: true,
      value: { description: 'a', completed: true },
    });
  });

  it('rejects an empty object', () => {
    assertRejected(validatePatch({}), /at least one/i);
  });

  it('rejects completed that is not a JSON boolean (D-3)', () => {
    for (const completed of ['true', 'false', 1, 0, null, [], {}]) {
      assertRejected(validatePatch({ completed }), /true or false/i);
    }
  });

  it('applies the description rules to edits (AC4)', () => {
    assertRejected(validatePatch({ description: '   ' }), /empty/i);
    assertRejected(validatePatch({ description: 'a'.repeat(201) }), /200/);
    assertRejected(validatePatch({ description: 'a\nb' }));
    assertRejected(validatePatch({ description: 'a\uD800' }), /unicode/i);
    assertRejected(validatePatch({ description: 5 }), /string/i);
  });

  it('rejects unknown fields, including id and createdAt', () => {
    assertRejected(validatePatch({ completed: true, foo: 1 }), /unknown field/i);
    assertRejected(validatePatch({ id: 2 }), /unknown field/i);
    assertRejected(validatePatch({ createdAt: 'x', completed: true }), /unknown field/i);
    assertRejected(validatePatch({ updatedAt: 'x' }), /unknown field/i);
  });

  it('rejects bodies that are not plain objects', () => {
    for (const body of [null, undefined, [], [{ completed: true }], 0, 'x', false]) {
      assertRejected(validatePatch(body), /JSON object/);
    }
  });
});

describe('validateDescription', () => {
  it('returns the trimmed value', () => {
    assert.deepEqual(validateDescription('  hi '), { ok: true, value: 'hi' });
  });
});

describe('parseId', () => {
  it('accepts valid positive integers', () => {
    assert.equal(parseId('1'), 1);
    assert.equal(parseId('42'), 42);
    assert.equal(parseId('9007199254740991'), 9007199254740991);
    assert.equal(parseId('1234567890123456'), 1234567890123456);
  });

  it('rejects invalid forms', () => {
    for (const s of ['0', '01', '-1', '1.5', 'abc', '', ' 1', '1 ', '+1', '1e3', '0x1']) {
      assert.equal(parseId(s), null, `parseId(${JSON.stringify(s)})`);
    }
  });

  it('rejects 17 digits and unsafe integers', () => {
    assert.equal(parseId('12345678901234567'), null);
    assert.equal(parseId('9007199254740993'), null);
    assert.equal(parseId('9999999999999999'), null);
  });

  it('rejects non-strings', () => {
    for (const v of [1, null, undefined, {}, []]) {
      assert.equal(parseId(v), null);
    }
  });
});
