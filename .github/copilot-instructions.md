<!-- Copilot / AI agent guidance for the NovaBot project -->
# Copilot Instructions — NovaBot

Purpose: make AI coding agents immediately productive in this repo by highlighting architecture, workflows, conventions, and concrete examples.

1) Big picture
- This is a small Node.js + static-frontend chatbot: backend in `server.js` (Express) and frontend in `public/index.html`.
- Frontend posts conversation history to the single API: `POST /api/chat` with JSON { messages: [ { role, content }, ... ] }.
- Backend calls the Anthropics (Claude) API using the env var `ANTHROPIC_API_KEY` and returns `{ reply: string }`.

2) Important files
- `server.js` — core logic: Express server, `SYSTEM_PROMPT` (editable), API call to `https://api.anthropic.com/v1/messages`, and static hosting.
- `public/index.html` — single-page UI: keeps a `history` array (objects with `role` and `content`) and sends it to `/api/chat`.
- `package.json` — scripts: `npm install`, `npm start` (runs `node server.js`).
- `.env.example` — shows required env vars. Do NOT commit real API keys.
- `README.md` — setup and deployment notes for Railway/Render; use as canonical run instructions.

3) Project-specific conventions & patterns
- Message shape: frontend uses { role: 'user' | 'assistant', content: string }. Keep this format when changing front/back.
- Backend expects `messages` to be an array; validate before calling external API (server.js already does this).
- System prompt: `SYSTEM_PROMPT` in `server.js` is the canonical place to store company-specific context; update here for client customizations.
- Response mapping: server extracts `data.content?.[0]?.text` and returns `{ reply }`. If you change the external API shape, update this mapping.

4) Error handling & edge cases observed
- Missing API key -> server returns 500 with `API key not configured`.
- The server logs errors to console and returns 500 on fetch failures — maintain this pattern for observability.
- Frontend shows a user-friendly fallback message on network errors. Follow similar UX in any new endpoints.

5) Run / dev / deploy commands (concrete)
- Local dev (Windows PowerShell):
```
npm install
copy .env.example .env
# edit .env and set ANTHROPIC_API_KEY
npm start
# open http://localhost:3000
```
- Deploy notes: README contains Railway/Render instructions; `Start Command` = `node server.js`, `Build` = `npm install`.

6) Security & secrets
- Never commit `.env` or API keys. Use `ANTHROPIC_API_KEY` in environment for CI/hosting.
- Frontend does not contain any secret; backend performs the external API call.

7) Quick examples for agents (edits / fixes)
- To update the system prompt for a new client, edit `SYSTEM_PROMPT` in `server.js` (keep the same variable name).
- To change model or token limit, update the fetch body in `server.js` (currently `model: "claude-haiku-4-5-20251001"`, `max_tokens: 1000`).
- To add request timeout or retry logic, wrap the `fetch` call with a timeout and retry policy and return clear error messages.

8) Tests and CI
- No tests or CI config found. If you add tests, call them with `npm test` and document the command in `package.json`.

9) Language & comments
- Source contains English + Arabic comments. Preserve language context when editing existing messages or UI text.

If any section is unclear or you want more details (e.g., recommended retry/backoff, telemetry, or adding unit tests), tell me which area to expand and I will update this file.
