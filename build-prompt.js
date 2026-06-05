/* Assembles PROMPT.md so its embedded source always matches the real files
 * byte-for-byte. Run: node build-prompt.js
 *
 * PROMPT.md = docs/prompt-intro.md
 *           + PART 1 (verbatim source of every app file)
 *           + PART 2 (docs/prompt-reference.md — the spec/acceptance/gotchas)
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

// The files that ARE the application, in build order.
const FILES = [
  { p: 'package.json',         lang: 'json' },
  { p: 'server.js',            lang: 'js'   },
  { p: 'ai.js',                lang: 'js'   },
  { p: 'public/index.html',    lang: 'html' },
  { p: 'public/styles.css',    lang: 'css'  },
  { p: 'public/app.js',        lang: 'js'   },
  { p: 'public/conference.js', lang: 'js'   },
  { p: 'README.md',            lang: 'markdown' },
];

// Choose a fence longer than any backtick run inside the content (so files that
// themselves contain ``` — like README.md — embed without breaking the block).
function fenceFor(content) {
  let max = 0;
  for (const run of content.match(/`+/g) || []) max = Math.max(max, run.length);
  return '`'.repeat(Math.max(3, max + 1));
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let out = read('docs/prompt-intro.md').replace(/\n+$/, '') + '\n\n';

out += '---\n\n# PART 1 — EXACT SOURCE FILES (reproduce verbatim)\n\n';
out += 'Create each file at the path in its heading, with the exact contents in the code block.\n';

for (const f of FILES) {
  const content = read(f.p).replace(/\n+$/, '');
  const fence = fenceFor(content);
  out += '\n## `' + f.p + '`\n\n' + fence + f.lang + '\n' + content + '\n' + fence + '\n';
}

out += '\n---\n\n# PART 2 — REFERENCE (how it works · for understanding & verification)\n\n';
out += 'Part 1 is the source of truth. The following describes intent, behavior, and the\n';
out += 'acceptance criteria to verify the reproduction.\n\n';
out += read('docs/prompt-reference.md').replace(/\n+$/, '') + '\n';

fs.writeFileSync(path.join(ROOT, 'PROMPT.md'), out);
console.log('PROMPT.md written:', out.length, 'bytes,', out.split('\n').length, 'lines');
