<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor and change safety

- Prefer small, reviewed diffs: inspect agent edits before you commit.
- Use branches for experiments; commit often so history is easy to bisect.
- Environment and secrets belong in `.env*` files (gitignored), not in chat or committed code.
- Optional rollback anchor: git tag `baseline-before-cursor` marks a pre–Cursor-editor baseline on this repo (`git show baseline-before-cursor` to inspect; use `git checkout baseline-before-cursor` or `git reset --hard baseline-before-cursor` only when you intend to move HEAD—see git docs).
