# Build Prompt — NYS Virtual Waiting Room (VWR) + In-house Conferencing

> **Goal: reproduce this exact application.** This prompt contains the complete, verbatim source
> of every file. To get an identical result in any CLI (Claude Code, Cursor, Aider, Gemini CLI,
> etc.), follow the instructions below literally.

## HOW TO USE THIS PROMPT (read first)

1. **Reproduce Part 1 verbatim.** Create each file in **PART 1 — EXACT SOURCE FILES** at the
   exact path shown, with the **exact** contents shown. Do **not** paraphrase, reformat, rename,
   re-order, "improve," refactor, or upgrade anything. Copy byte-for-byte.
2. **Do not change dependency versions.** `package.json` pins exact versions on purpose
   (`@nysds/*@1.18.3`, `express@4.22.2`, `socket.io@4.8.3`). Identical NYSDS versions matter —
   the component APIs and the bundled icon set must match.
3. **Then run:**
   ```bash
   npm install
   npm start
   ```
   The app serves at **http://localhost:3000**.
4. **Verify** against the acceptance criteria in **PART 2 — REFERENCE**. Part 2 is explanatory
   context (how/why it works); if Part 2 ever seems to disagree with Part 1, **Part 1 (the
   source) is authoritative.**

## TWO MISTAKES THAT BREAK THE BUILD (do not "fix" these — they are intentional)

- **NYSDS CSS:** `index.html` loads the **tokens** build `/nysds/styles/nysds.min.css`. Do NOT
  switch it to `nysds-full.min.css` — the full build's global element reset destroys the layout.
- **NYSDS components:** `index.html` loads the **UMD** build `/nysds/components/nysds.js` as a
  classic `<script defer>`. Do NOT switch it to the ESM `nysds.es.js` with `type="module"` — that
  build has bare `import ... from "lit"` specifiers the browser can't resolve, so it silently
  fails and **no `nys-*` element renders** (the login button disappears).

These two lines in `index.html` are correct as written. Reproduce them exactly.
