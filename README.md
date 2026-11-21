# Luma — personal AI workspace

A private, responsive chat workspace with a Material 3 expressive interface, Groq, Gemini, and AxForge Qwen providers, prompt-based Auto routing, saved chats, and persistent email/password accounts.

## Features

- Account registration and sign-in with scrypt password hashes, secure session cookies, rate limits, and CSRF protection.
- User-owned conversations and messages stored in PostgreSQL.
- Server-streamed answers from Groq, Gemini, or AxForge Qwen. Provider keys stay on the server.
- Auto mode routes coding and analysis prompts to Groq and everyday prompts to Gemini, with configured providers as fallbacks. If one provider key is set, Auto uses it.
- Manual provider selection, conversation search, copy/regenerate actions, keyboard shortcuts, and light/dark/system themes.

## Deploy on Vercel

1. Import this GitHub repository in Vercel. Vercel detects the Express app in `server.js`; the static UI is in `public/`.
2. In Vercel's **Storage** or **Marketplace**, connect a PostgreSQL provider such as Neon. Use its pooled connection string for `DATABASE_URL`.
3. In the Vercel project **Settings → Environment Variables**, set:
   - `DATABASE_URL` — PostgreSQL connection string.
   - `SESSION_SECRET` — a long random secret. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
   - `GROQ_API_KEY`, `GEMINI_API_KEY`, and/or `QWEN_API_KEY` — the provider keys you want to use. For AxForge, the default shared API model is `qwen3.8-27b-nvfp4`; optionally override it with `AXFORGE_MODEL`.
   - `ALLOW_SIGNUP` — leave unset or set to `false` to permit only the first account; set to `true` if you want open registration.
4. Redeploy after setting variables, then open the Vercel `*.vercel.app` URL and create your account.

Vercel provisions HTTPS and includes baseline security protections. Its free Hobby plan is for personal, noncommercial use. Vercel Marketplace integrations can be provisioned from its dashboard; database provider pricing and limits still apply.

## Run locally

Requires Node.js 20+ and PostgreSQL. Copy `.env.example` to `.env`, set `DATABASE_URL` and a long random `SESSION_SECRET`, then run:

```sh
npm install
npm run dev
```

Visit `http://localhost:3000`. Add provider keys to `.env` for chat. Keep real keys out of source control.

## Model defaults

The default model IDs are `openai/gpt-oss-120b` on Groq, `gemini-3.8-flash` on Gemini, and `qwen3.8-27b-nvfp4` on AxForge. Override them with `GROQ_MODEL`, `GEMINI_MODEL`, or `AXFORGE_MODEL`. Auto routing uses a prompt heuristic; it doesn't benchmark or query every provider for each message. AxForge's published shared API offers Qwen3.8 27B; Qwen3.8-Flash-Next is listed in its catalog but requires a dedicated deployment/endpoint rather than the shared API key alone.

