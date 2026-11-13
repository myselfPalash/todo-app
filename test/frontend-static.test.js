// Static safety and accessibility checks on the frontend files (no server).
// Covers NFR-2 (no HTML-string sinks, no inline script/style/handlers so the
// CSP does not block anything), NFR-6 (labels, accessible names) and L-1.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.join(import.meta.dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

describe('public/app.js', () => {
  it('uses no HTML-string sinks or dynamic code execution', () => {
    for (const banned of [
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'document.write',
      'eval(',
      'new Function',
    ]) {
      assert.ok(!appJs.includes(banned), `app.js must not contain ${JSON.stringify(banned)}`);
    }
  });

  it('does not pass a string to setTimeout/setInterval', () => {
    assert.doesNotMatch(appJs, /set(Timeout|Interval)\s*\(\s*['"`]/);
  });

  it('renders text with textContent', () => {
    assert.ok(appJs.includes('textContent'));
  });

  it('gives task buttons accessible names', () => {
    assert.ok(appJs.includes('Delete task: '));
    assert.ok(appJs.includes('Edit task: '));
    assert.ok(appJs.includes('Mark complete: '));
    assert.ok(appJs.includes('Mark pending: '));
  });

  it('shows status as text, not colour alone', () => {
    assert.ok(appJs.includes("'Completed'"));
    assert.ok(appJs.includes("'Pending'"));
  });

  it('checks description length in code points (L-1) and mirrors the server rules', () => {
    assert.ok(appJs.includes('[...'), 'expected a code-point length check ([...s].length)');
    assert.ok(appJs.includes('.trim()'));
    assert.match(appJs, /MAX_DESCRIPTION\s*=\s*200\b/);
    assert.ok(appJs.includes('\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029'));
  });

  it('uses only relative API URLs', () => {
    assert.doesNotMatch(appJs, /https?:\/\//);
    assert.ok(appJs.includes("'/api/tasks'"));
  });

  it('does not set inline styles (CSP style-src self)', () => {
    assert.doesNotMatch(appJs, /\.style\b/);
    assert.doesNotMatch(appJs, /setAttribute\(\s*['"]style['"]/);
  });

  it('shows "Cannot reach server" when fetch rejects', () => {
    assert.ok(appJs.includes('Cannot reach server'));
  });
});

describe('public/index.html', () => {
  it('is a basic HTML5 document', () => {
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/i);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>Todo<\/title>/);
  });

  it('has no inline script content', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length, 1, 'exactly one script element');
    for (const [, attrs, body] of scripts) {
      assert.equal(body.trim(), '', 'script element must be empty');
      assert.match(attrs, /\bsrc="\/app\.js"/);
      assert.match(attrs, /\btype="module"/);
    }
  });

  it('has no <style> element or style= attribute', () => {
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /\sstyle\s*=/i);
  });

  it('has no inline on* event handler attributes', () => {
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  });

  it('references only /app.js and /styles.css', () => {
    const refs = [...html.matchAll(/\s(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).sort();
    assert.deepEqual(refs, ['/app.js', '/styles.css']);
    assert.doesNotMatch(html, /https?:/i);
  });

  it('has a labelled input for new tasks', () => {
    assert.ok(html.includes('<label for="new-task">'));
    assert.ok(html.includes('id="new-task"'));
    assert.match(html, /<input[^>]*id="new-task"[^>]*maxlength="200"/);
  });

  it('has the add form, list, error region, empty state and noscript message', () => {
    assert.match(html, /<main>/);
    assert.match(html, /<h1>/);
    assert.match(html, /<form id="add-form"/);
    assert.match(html, /<button type="submit">Add<\/button>/);
    assert.match(html, /<ul id="task-list"/);
    assert.match(html, /<p id="error"[^>]*aria-live="polite"/);
    assert.ok(html.includes('No tasks yet.'));
    assert.match(html, /<noscript>[\s\S]*<\/noscript>/);
  });
});

describe('public/styles.css', () => {
  it('loads no external resources', () => {
    assert.doesNotMatch(css, /url\(|@import|https?:/i);
  });

  it('has a visible focus style and a strikethrough for completed tasks', () => {
    assert.match(css, /:focus-visible[\s\S]*?outline:/);
    assert.match(css, /line-through/);
  });
});
