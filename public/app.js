// Todo app frontend (architecture §9, D-7).
// Safe rendering only: elements are built with createElement and filled with
// textContent / value / setAttribute (NFR-2). The list is re-fetched from the
// server after every successful change, so the screen shows the server's truth.

const API = '/api/tasks';
const MAX_DESCRIPTION = 200;
// Same rule as the server (src/validation.js): C0, DEL, C1, U+2028, U+2029.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const NETWORK_ERROR = 'Cannot reach server. Check that it is running and try again.';

const addForm = document.getElementById('add-form');
const newTaskInput = document.getElementById('new-task');
const errorRegion = document.getElementById('error');
const taskList = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');

let tasks = [];
let editingId = null;
let busy = false;

class NetworkError extends Error {}

// ---------- validation (client mirror of NFR-1, L-1, L-3) ----------

/** Returns { ok: true, value } or { ok: false, message }. */
function validateDescription(input) {
  if (typeof input !== 'string') {
    return { ok: false, message: 'Description must be text.' };
  }
  if (typeof input.isWellFormed === 'function' && !input.isWellFormed()) {
    return { ok: false, message: 'Description contains invalid Unicode characters.' };
  }
  const value = input.trim();
  const length = [...value].length; // Unicode code points, like the server.
  if (length === 0) {
    return { ok: false, message: 'Description must not be empty.' };
  }
  if (length > MAX_DESCRIPTION) {
    return { ok: false, message: `Description must be at most ${MAX_DESCRIPTION} characters.` };
  }
  if (FORBIDDEN_CHARS.test(value)) {
    return { ok: false, message: 'Description must be a single line without control characters.' };
  }
  return { ok: true, value };
}

// ---------- messages ----------

function showError(message) {
  errorRegion.textContent = message;
}

function clearError() {
  errorRegion.textContent = '';
}

// ---------- HTTP ----------

/**
 * Sends a request to the API. Resolves to { ok, status, data } for any HTTP
 * response; rejects with NetworkError when the server cannot be reached.
 */
async function request(method, url, body) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new NetworkError(NETWORK_ERROR);
  }
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function errorMessage(result) {
  const message = result.data && result.data.error && result.data.error.message;
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  return `Request failed (HTTP ${result.status}).`;
}

function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('#add-form input, #add-form button, #task-list input, #task-list button')) {
    control.disabled = value;
  }
  taskList.setAttribute('aria-busy', value ? 'true' : 'false');
}

// ---------- loading and rendering ----------

/** Fetches the list and renders it. Returns true on success. Never clears the error region. */
async function loadTasks() {
  let result;
  try {
    result = await request('GET', API);
  } catch (err) {
    showError(err instanceof NetworkError ? err.message : NETWORK_ERROR);
    return false;
  }
  if (!result.ok || !result.data || !Array.isArray(result.data.tasks)) {
    showError(result.ok ? 'Unexpected response from server.' : errorMessage(result));
    return false;
  }
  tasks = result.data.tasks;
  if (editingId !== null && !tasks.some((task) => task.id === editingId)) {
    editingId = null;
  }
  render();
  return true;
}

function render() {
  const items = tasks.map((task) => (task.id === editingId ? renderEditItem(task) : renderItem(task)));
  taskList.replaceChildren(...items);
  emptyState.hidden = tasks.length > 0;
  if (busy) setBusy(true);
}

function makeButton(text, label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  if (className) button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

function renderItem(task) {
  const item = document.createElement('li');
  item.className = task.completed ? 'task completed' : 'task';
  item.dataset.id = String(task.id);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute(
    'aria-label',
    task.completed ? `Mark pending: ${task.description}` : `Mark complete: ${task.description}`
  );
  checkbox.addEventListener('change', () => toggleTask(task, checkbox));

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.description;

  const badge = document.createElement('span');
  badge.className = task.completed ? 'badge done' : 'badge pending';
  badge.textContent = task.completed ? 'Completed' : 'Pending';

  const actions = document.createElement('span');
  actions.className = 'task-actions';
  const editButton = makeButton('Edit', `Edit task: ${task.description}`, 'secondary', () => startEdit(task.id));
  editButton.dataset.role = 'edit';
  const deleteButton = makeButton('Delete', `Delete task: ${task.description}`, 'danger', () => deleteTask(task));
  actions.append(editButton, deleteButton);

  item.append(checkbox, text, badge, actions);
  return item;
}

function renderEditItem(task) {
  const item = document.createElement('li');
  item.className = 'task editing';
  item.dataset.id = String(task.id);

  const form = document.createElement('form');
  form.className = 'edit-row';
  form.noValidate = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = MAX_DESCRIPTION;
  input.autocomplete = 'off';
  input.value = task.description;
  input.setAttribute('aria-label', `New description for task: ${task.description}`);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit(task.id);
    }
  });

  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  save.setAttribute('aria-label', `Save task: ${task.description}`);

  const cancel = makeButton('Cancel', `Cancel editing task: ${task.description}`, 'secondary', () => cancelEdit(task.id));

  // Enter in the input submits the form, which saves.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEdit(task, input);
  });

  form.append(input, save, cancel);
  item.append(form);
  return item;
}

function focusEditButton(id) {
  const item = taskList.querySelector(`li[data-id="${Number(id)}"]`);
  const button = item && item.querySelector('button[data-role="edit"]');
  if (button) button.focus();
}

// ---------- actions ----------

function startEdit(id) {
  if (busy) return;
  editingId = id;
  render();
  const input = taskList.querySelector(`li[data-id="${Number(id)}"] input[type="text"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

function cancelEdit(id) {
  if (busy) return;
  editingId = null;
  render(); // Restores the original text from the last server state.
  focusEditButton(id);
}

/**
 * Runs one mutation with all controls disabled. On success: clears the error
 * and re-fetches the list.
 * On failure: shows the error and keeps the current list and inputs (NFR-4);
 * on a 404 it then re-fetches the list (L-6).
 * Returns true on success.
 */
async function mutate(method, url, body) {
  if (busy) return false;
  setBusy(true);
  try {
    let result;
    try {
      result = await request(method, url, body);
    } catch (err) {
      showError(err instanceof NetworkError ? err.message : NETWORK_ERROR);
      return false;
    }
    if (!result.ok) {
      showError(errorMessage(result));
      if (result.status === 404) {
        await loadTasks();
      }
      return false;
    }
    clearError();
    await loadTasks(); // Re-sync while controls are still disabled (D-7).
    return true;
  } finally {
    setBusy(false);
  }
}

async function addTask(event) {
  event.preventDefault();
  if (busy) return;
  const check = validateDescription(newTaskInput.value);
  if (!check.ok) {
    showError(check.message);
    newTaskInput.focus();
    return;
  }
  const ok = await mutate('POST', API, { description: check.value });
  if (ok) {
    newTaskInput.value = ''; // Cleared only on success; kept on failure.
  }
  newTaskInput.focus();
}

async function toggleTask(task, checkbox) {
  const completed = checkbox.checked;
  const ok = await mutate('PATCH', `${API}/${encodeURIComponent(task.id)}`, { completed });
  if (!ok && checkbox.isConnected) {
    checkbox.checked = !completed; // The list stays as it was.
  }
}

async function saveEdit(task, input) {
  if (busy) return;
  const check = validateDescription(input.value);
  if (!check.ok) {
    showError(check.message);
    input.focus();
    return;
  }
  if (check.value === task.description) {
    clearError();
    cancelEdit(task.id);
    return;
  }
  const ok = await mutate('PATCH', `${API}/${encodeURIComponent(task.id)}`, { description: check.value });
  if (ok) {
    editingId = null;
    render(); // Leave edit mode using the list that was just re-fetched.
    focusEditButton(task.id);
  } else if (input.isConnected) {
    input.focus(); // Keep the user's text so they can retry.
  }
}

async function deleteTask(task) {
  const ok = await mutate('DELETE', `${API}/${encodeURIComponent(task.id)}`);
  if (ok) {
    newTaskInput.focus();
  }
}

// ---------- start ----------

addForm.addEventListener('submit', addTask);
loadTasks();
