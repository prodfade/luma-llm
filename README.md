# Luma — personal AI workspace

A responsive LLM chat app with a Material 3 expressive visual system, Groq and Gemini providers, prompt-based Auto routing, saved conversations, and persistent email/password accounts.

## Included

- Account registration and sign-in with scrypt password hashes, session cookies, rate limits, and CSRF checks.
- User-owned conversations and messages stored in PostgreSQL.
- Server-streamed responses from Groq or Gemini; provider keys stay on the server.
- Auto mode routes coding and analysis prompts to Groq, and general prompts to Gemini. When only one provider key is configured, Auto uses that provider.
- Manual Groq/Gemini selection, conversation search, copy/regenerate actions, responsive sidebar, keyboard shortcuts, and light/dark/system themes.
- Render Blueprint for the web service and Postgres database.

## Run locally

Requires Node.js 20+ and PostgreSQL. Create a database, copy `.env.example` to `.env`, set `DATABASE_URL` and a long random `SESSION_SECRET`, then run:

```sh
npm install
npm run dev
```

Visit `http://localhost:3000`. Add `GROQ_API_KEY` and/or `GEMINI_API_KEY` to `.env` for chat. Keep real keys out of source control.

## Deploy to Render

1. Push this repository to a Git provider supported by Render.
2. In Render, create a Blueprint from the repository and review the proposed web service and Postgres resources before applying. The Blueprint uses a 0.5 CPU / 512 MB web service and a 0.1 CPU / 256 MB Postgres database. Both are paid compute plans; review current plan pricing in Render before approval.
3. Add `GROQ_API_KEY` and `GEMINI_API_KEY` in the web service's **Environment** page. Add either or both. Save and deploy after setting the keys.
4. Open the service URL and create the first account. Signup is limited to the first account by default (`ALLOW_SIGNUP=false`) for this personal workspace. To allow more accounts, set `ALLOW_SIGNUP=true` in Render.

Render stores the database connection and session secret through Blueprint references/generation. Provider keys are declared as `sync: false` so they are entered through Render, not committed into `render.yaml`.

## Model defaults

The current default model IDs are `openai/gpt-oss-120b` on Groq and `gemini-3.8-flash` on Gemini. Override them with `GROQ_MODEL` or `GEMINI_MODEL` if needed. Auto routing is a local prompt heuristic; it doesn't benchmark or ask both providers for each message.

