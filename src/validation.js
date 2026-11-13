// Pure input validation for the Todo API (NFR-1). No I/O.
// Every function returns { ok: true, value } or { ok: false, message }.

export const MAX_DESCRIPTION = 200;

const CREATE_FIELDS = new Set(['description']);
const PATCH_FIELDS = new Set(['description', 'completed']);

// C0 controls, DEL, C1 controls, LINE SEPARATOR, PARAGRAPH SEPARATOR (D-4, L-3).
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

const ID_PATTERN = /^[1-9][0-9]{0,15}$/;

function fail(message) {
  return { ok: false, message };
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkFields(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return fail(`Unknown field: ${JSON.stringify(key).slice(0, 60)}.`);
    }
  }
  return null;
}

/**
 * Validates and normalizes a task description.
 * Leading/trailing whitespace is trimmed first; the remaining text must be
 * 1..MAX_DESCRIPTION Unicode code points, well-formed, and single-line.
 */
export function validateDescription(input) {
  if (typeof input !== 'string') {
    return fail('Description must be a string.');
  }
  if (!input.isWellFormed()) {
    return fail('Description contains invalid Unicode characters.');
  }
  const value = input.trim();
  const length = [...value].length;
  if (length === 0) {
    return fail('Description must not be empty.');
  }
  if (length > MAX_DESCRIPTION) {
    return fail(`Description must be at most ${MAX_DESCRIPTION} characters.`);
  }
  if (FORBIDDEN_CHARS.test(value)) {
    return fail('Description must be a single line without control characters.');
  }
  return { ok: true, value };
}

/** Validates a POST /api/tasks body: exactly { description }. */
export function validateCreate(body) {
  if (!isPlainObject(body)) {
    return fail('Request body must be a JSON object.');
  }
  const fieldError = checkFields(body, CREATE_FIELDS);
  if (fieldError) return fieldError;
  if (!Object.hasOwn(body, 'description')) {
    return fail('Description is required.');
  }
  const description = validateDescription(body.description);
  if (!description.ok) return description;
  return { ok: true, value: { description: description.value } };
}

/** Validates a PATCH /api/tasks/{id} body: { description?, completed? }, at least one. */
export function validatePatch(body) {
  if (!isPlainObject(body)) {
    return fail('Request body must be a JSON object.');
  }
  const fieldError = checkFields(body, PATCH_FIELDS);
  if (fieldError) return fieldError;

  const hasDescription = Object.hasOwn(body, 'description');
  const hasCompleted = Object.hasOwn(body, 'completed');
  if (!hasDescription && !hasCompleted) {
    return fail('Provide at least one of: description, completed.');
  }

  const value = {};
  if (hasDescription) {
    const description = validateDescription(body.description);
    if (!description.ok) return description;
    value.description = description.value;
  }
  if (hasCompleted) {
    if (typeof body.completed !== 'boolean') {
      return fail('Completed must be true or false.');
    }
    value.completed = body.completed;
  }
  return { ok: true, value };
}

/** Parses a task ID path segment. Returns a safe positive integer or null. */
export function parseId(str) {
  if (typeof str !== 'string' || !ID_PATTERN.test(str)) {
    return null;
  }
  const id = Number(str);
  return Number.isSafeInteger(id) ? id : null;
}
