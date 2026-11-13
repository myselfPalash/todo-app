// REST handlers for /api/tasks (architecture §5; FR-1…FR-7).
// Uses only validation.js and the repository from db.js.
import { parseId, validateCreate, validatePatch } from './validation.js';
import { readJsonBody, sendEmpty, sendError, sendJson } from './http-utils.js';

const COLLECTION = '/api/tasks';
const ITEM_PATTERN = /^\/api\/tasks\/([^/]+)$/;
const COLLECTION_ALLOW = 'GET, POST';
const ITEM_ALLOW = 'GET, PATCH, DELETE';

function notFound(res, message = 'Not found.') {
  sendError(res, 404, 'NOT_FOUND', message);
}

function methodNotAllowed(res, allow) {
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { Allow: allow });
}

function validationError(res, message) {
  sendError(res, 400, 'VALIDATION_ERROR', message);
}

/**
 * Handles a request whose pathname starts with /api.
 * Errors from readJsonBody (HttpError, ClientAbortedError) and repository
 * failures propagate to the caller (src/app.js), which maps them to responses.
 */
export async function handleApi(req, res, pathname, repo) {
  if (pathname === COLLECTION) {
    switch (req.method) {
      case 'GET':
        sendJson(res, 200, { tasks: repo.list() });
        return;
      case 'POST': {
        const body = await readJsonBody(req);
        const result = validateCreate(body);
        if (!result.ok) {
          validationError(res, result.message);
          return;
        }
        const task = repo.create(result.value.description);
        sendJson(res, 201, task, { Location: `${COLLECTION}/${task.id}` });
        return;
      }
      default:
        methodNotAllowed(res, COLLECTION_ALLOW);
        return;
    }
  }

  const match = ITEM_PATTERN.exec(pathname);
  if (!match) {
    notFound(res);
    return;
  }

  if (!['GET', 'PATCH', 'DELETE'].includes(req.method)) {
    methodNotAllowed(res, ITEM_ALLOW);
    return;
  }

  const id = parseId(match[1]);
  if (id === null) {
    notFound(res, 'Task not found.');
    return;
  }

  switch (req.method) {
    case 'GET': {
      const task = repo.get(id);
      if (!task) {
        notFound(res, 'Task not found.');
        return;
      }
      sendJson(res, 200, task);
      return;
    }
    case 'PATCH': {
      const body = await readJsonBody(req);
      const result = validatePatch(body);
      if (!result.ok) {
        validationError(res, result.message);
        return;
      }
      const task = repo.update(id, result.value);
      if (!task) {
        notFound(res, 'Task not found.');
        return;
      }
      sendJson(res, 200, task);
      return;
    }
    case 'DELETE': {
      if (!repo.remove(id)) {
        notFound(res, 'Task not found.');
        return;
      }
      sendEmpty(res, 204);
      return;
    }
  }
}
