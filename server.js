import 'dotenv/config';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production.');
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 10
});
const PgSession = connectPgSimple(session);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://api.groq.com', 'https://api.axforge.ai', 'https://generativelanguage.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'local-development-only-change-before-deploy',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.param('id', (req, res, next, id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(404).json({ error: 'Chat not found.' });
  next();
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at);
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function passwordMatches(password, stored) {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function csrfFor(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const token = req.get('x-csrf-token');
  if (!token || token !== req.session.csrfToken) return res.status(403).json({ error: 'Refresh the page and try again.' });
  next();
}

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.created_at };
}

function providerModel(provider) {
  if (provider === 'groq') return process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  return process.env.AXFORGE_MODEL || 'qwen3.8-27b-nvfp4';
}

function providerLabel(provider) {
  return provider === 'groq' ? 'Groq' : provider === 'gemini' ? 'Gemini' : 'Qwen · AxForge';
}

function configuredProviders() {
  return ['groq', 'gemini', 'axforge'].filter(provider => Boolean({
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    axforge: process.env.QWEN_API_KEY
  }[provider]));
}

function autoRoute(text, hasImages = false) {
  const content = text.toLowerCase();
  const available = configuredProviders();
  if (hasImages) {
    const provider = ['axforge', 'gemini'].find(candidate => available.includes(candidate));
    if (!provider) return null;
    return { provider, model: providerModel(provider), reason: `Best fit for images · ${providerLabel(provider)}` };
  }
  const coding = /\b(code|coding|program|programming|debug|typescript|javascript|python|sql|regex|api|compile|function|class|stack trace|bug|error|algorithm)\b/.test(content);
  const complexity = /\b(prove|derive|step by step|compare|trade-?offs|architecture|analyze|reasoning|deep dive|design a system)\b/.test(content);
  const preferred = coding || complexity ? 'groq' : 'gemini';
  const provider = available.includes(preferred) ? preferred : available[0] || preferred;
  const reason = available.length === 1 ? `Only ${providerLabel(provider)} is connected`
    : provider === 'groq' ? (coding ? 'Strong at code and debugging' : 'Selected for deeper analysis')
      : provider === 'gemini' ? 'Selected for fast everyday help' : 'Using your connected Qwen model';
  return { provider, model: providerModel(provider), reason };
}

async function readSse(response, onData) {
  if (!response.ok) {
    const body = await response.text();
    let message = `Provider request failed (${response.status}).`;
    try { message = JSON.parse(body).error?.message || message; } catch {}
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { await onData(JSON.parse(data)); } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    }
    if (done) break;
  }
}

async function streamCompletion({ provider, model, messages, onDelta, signal }) {
  if (provider === 'groq' || provider === 'axforge') {
    const apiKey = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.QWEN_API_KEY;
    const providerName = providerLabel(provider);
    const keyName = provider === 'groq' ? 'GROQ_API_KEY' : 'QWEN_API_KEY';
    if (!apiKey) throw new Error(`${providerName} is not set up yet. Add ${keyName} in your deployment environment settings.`);
    const endpoint = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.axforge.ai/v1/chat/completions';
    const hasImages = messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
    const response = await fetch(endpoint, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: !(provider === 'axforge' && hasImages), temperature: 0.7 })
    });
    if (provider === 'axforge' && hasImages) {
      if (!response.ok) {
        const body = await response.text();
        let message = `AxForge request failed (${response.status}).`;
        try { message = JSON.parse(body).error?.message || message; } catch {}
        throw new Error(message);
      }
      const result = await response.json();
      const answer = result.choices?.[0]?.message?.content;
      if (typeof answer === 'string' && answer) onDelta(answer);
      else if (Array.isArray(answer)) onDelta(answer.map(part => part.text || '').join(''));
      return;
    }
    await readSse(response, chunk => {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) onDelta(delta);
    });
    return;
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini is not set up yet. Add GEMINI_API_KEY in your deployment environment settings.');
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: (Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]).flatMap(part => {
      if (part.type === 'text') return part.text ? [{ text: part.text }] : [];
      const url = part.image_url?.url || '';
      const match = url.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
      return match ? [{ inlineData: { mimeType: match[1], data: match[2] } }] : [];
    })
  }));
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } })
  });
  await readSse(response, chunk => {
    const delta = chunk.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (delta) onDelta(delta);
  });
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/session', asyncRoute(async (req, res) => {
  const csrfToken = csrfFor(req);
  const providers = { groq: Boolean(process.env.GROQ_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), axforge: Boolean(process.env.QWEN_API_KEY) };
  if (!req.session.userId) return res.json({ user: null, csrfToken, providers });
  const { rows } = await pool.query('SELECT id,email,created_at FROM users WHERE id=$1', [req.session.userId]);
  if (!rows[0]) {
    req.session.destroy(() => {});
    return res.json({ user: null, csrfToken, providers });
  }
  res.json({ user: publicUser(rows[0]), csrfToken, providers });
}));

app.post('/api/auth/register', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Use a password between 10 and 128 characters.' });
  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    if (process.env.ALLOW_SIGNUP !== 'true') {
      await client.query('SELECT pg_advisory_xact_lock(71420931)');
      const { rows: existing } = await client.query('SELECT EXISTS(SELECT 1 FROM users) AS has_users');
      if (existing[0].has_users) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This personal workspace already has an account. Sign in, or enable ALLOW_SIGNUP in your deployment settings to allow more accounts.' });
      }
    }
    const { rows } = await client.query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at', [email, hashPassword(password)]);
    user = rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'An account already exists for that email.' });
    console.error('Registration failed:', error.message);
    return res.status(500).json({ error: 'Could not create your account. Try again.' });
  } finally {
    client.release();
  }
  try {
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ error: 'Could not start your session. Try again.' });
      req.session.userId = user.id;
      csrfFor(req);
      req.session.save(saveError => saveError ? res.status(500).json({ error: 'Could not start your session. Try again.' }) : res.json({ user: publicUser(user), csrfToken: req.session.csrfToken, providers: { groq: Boolean(process.env.GROQ_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), axforge: Boolean(process.env.QWEN_API_KEY) } }));
    });
  } catch { res.status(500).json({ error: 'Could not start your session. Try again.' }); }
}));

app.post('/api/auth/login', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT id,email,password_hash,created_at FROM users WHERE email=$1', [email]);
  if (!rows[0] || !passwordMatches(password, rows[0].password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not start your session. Try again.' });
    req.session.userId = rows[0].id;
    csrfFor(req);
    req.session.save(saveError => saveError ? res.status(500).json({ error: 'Could not start your session. Try again.' }) : res.json({ user: publicUser(rows[0]), csrfToken: req.session.csrfToken, providers: { groq: Boolean(process.env.GROQ_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), axforge: Boolean(process.env.QWEN_API_KEY) } }));
  });
}));

app.post('/api/auth/logout', requireCsrf, (req, res) => req.session.destroy(error => {
  if (error) return res.status(500).json({ error: 'Could not sign out.' });
  res.clearCookie('connect.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
}));

app.get('/api/chats', requireUser, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id,c.title,c.created_at,c.updated_at,
       (SELECT content FROM messages m WHERE m.chat_id=c.id AND m.role='user' ORDER BY m.created_at DESC LIMIT 1) AS preview
     FROM chats c WHERE c.user_id=$1 ORDER BY c.updated_at DESC LIMIT 100`, [req.session.userId]
  );
  res.json({ chats: rows });
}));

app.post('/api/chats', requireUser, requireCsrf, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('INSERT INTO chats(user_id) VALUES($1) RETURNING id,title,created_at,updated_at', [req.session.userId]);
  res.json({ chat: rows[0] });
}));

app.get('/api/chats/:id', requireUser, asyncRoute(async (req, res) => {
  const { rows: chats } = await pool.query('SELECT id,title,created_at,updated_at FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  if (!chats[0]) return res.status(404).json({ error: 'Chat not found.' });
  const { rows: messages } = await pool.query('SELECT id,role,content,attachments,model,created_at FROM messages WHERE chat_id=$1 AND user_id=$2 ORDER BY created_at ASC', [req.params.id, req.session.userId]);
  res.json({ chat: chats[0], messages });
}));

app.delete('/api/chats/:id', requireUser, requireCsrf, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM chats WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ ok: true });
}));

app.patch('/api/chats/:id', requireUser, requireCsrf, asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 100);
  if (!title) return res.status(400).json({ error: 'Enter a chat name.' });
  const { rows } = await pool.query('UPDATE chats SET title=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id,title,created_at,updated_at', [title, req.params.id, req.session.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat: rows[0] });
}));

app.post('/api/chats/:id/messages', requireUser, requireCsrf, chatLimiter, asyncRoute(async (req, res) => {
  const chatId = req.params.id;
  const text = String(req.body.message || '').trim();
  const requestedModel = String(req.body.model || 'auto');
  if (text.length > 24000) return res.status(400).json({ error: 'Write a message up to 24,000 characters.' });
  const incomingAttachments = req.body.attachments ?? [];
  if (!Array.isArray(incomingAttachments) || incomingAttachments.length > 8) return res.status(400).json({ error: 'Add up to 8 images per message.' });
  let imageBytes = 0;
  const attachments = [];
  for (const item of incomingAttachments) {
    const dataUrl = String(item?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || item?.mimeType !== match[1]) return res.status(400).json({ error: 'One of those images could not be read. Please upload it again.' });
    const bytes = Math.floor(match[2].length * 3 / 4) - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    imageBytes += bytes;
    if (imageBytes > 6 * 1024 * 1024) return res.status(413).json({ error: 'Keep images under 6 MB total per message.' });
    attachments.push({ name: String(item.name || 'Uploaded image').slice(0, 160), mimeType: match[1], dataUrl });
  }
  if (!text && !attachments.length) return res.status(400).json({ error: 'Write a message or add an image.' });
  const { rows: chats } = await pool.query('SELECT id,title FROM chats WHERE id=$1 AND user_id=$2', [chatId, req.session.userId]);
  if (!chats[0]) return res.status(404).json({ error: 'Chat not found.' });

  let selected;
  if (requestedModel === 'auto') selected = autoRoute(text, attachments.length > 0);
  else if (['groq', 'gemini', 'axforge'].includes(requestedModel)) selected = { provider: requestedModel, model: providerModel(requestedModel), reason: 'Chosen manually' };
  else return res.status(400).json({ error: 'Choose Auto, Groq, Gemini, or Qwen · AxForge.' });
  if (attachments.length && requestedModel === 'auto' && !selected) return res.status(400).json({ error: 'Image understanding needs Qwen · AxForge or Gemini. Add QWEN_API_KEY or GEMINI_API_KEY in Vercel.' });
  if (attachments.length && selected.provider === 'groq') {
    const visionProvider = ['axforge', 'gemini'].find(provider => configuredProviders().includes(provider));
    if (!visionProvider) return res.status(400).json({ error: 'Image understanding needs Qwen · AxForge or Gemini. Add QWEN_API_KEY or GEMINI_API_KEY in Vercel.' });
    selected = { provider: visionProvider, model: providerModel(visionProvider), reason: `Images need vision · using ${providerLabel(visionProvider)}` };
  }

  await pool.query('INSERT INTO messages(chat_id,user_id,role,content,attachments) VALUES($1,$2,\'user\',$3,$4::jsonb)', [chatId, req.session.userId, text, JSON.stringify(attachments)]);
  if (chats[0].title === 'New chat') {
    const title = text.replace(/\s+/g, ' ').slice(0, 58) || (attachments.length ? 'Image question' : 'New chat');
    await pool.query('UPDATE chats SET title=$1,updated_at=NOW() WHERE id=$2', [title, chatId]);
  } else {
    await pool.query('UPDATE chats SET updated_at=NOW() WHERE id=$1', [chatId]);
  }
  const { rows: history } = await pool.query('SELECT role,content,attachments FROM messages WHERE chat_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30', [chatId, req.session.userId]);
  const messages = history.reverse().map(({ role, content, attachments: messageAttachments = [] }) => ({
    role,
    content: role === 'user' && messageAttachments.length
      ? [{ type: 'text', text: content || 'Please describe the attached image.' }, ...messageAttachments.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))]
      : content
  }));

  res.status(200);
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let fullText = '';
  let metaSent = false;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const primary = selected;
    const attempts = requestedModel === 'auto' || attachments.length
      ? [primary, ...(attachments.length ? ['axforge', 'gemini'].filter(provider => configuredProviders().includes(provider)) : configuredProviders()).filter(provider => provider !== primary.provider).map(provider => ({
          provider, model: providerModel(provider), reason: `${providerLabel(primary.provider)} unavailable · using ${providerLabel(provider)}`
        }))]
      : [primary];
    let completed = false;
    for (const attempt of attempts) {
      selected = attempt;
      try {
        await streamCompletion({ provider: selected.provider, model: selected.model, messages, signal: controller.signal, onDelta: delta => {
          if (!metaSent) {
            send('meta', { provider: selected.provider, model: selected.model, reason: selected.reason });
            metaSent = true;
          }
          fullText += delta;
          send('delta', { text: delta });
        }});
        completed = true;
        break;
      } catch (error) {
        const hasAnotherAttempt = attempt !== attempts.at(-1);
        if (!hasAnotherAttempt || fullText || error.name === 'AbortError') throw error;
        console.warn(`Auto provider ${selected.provider} failed; trying ${attempts[attempts.indexOf(attempt) + 1].provider}:`, error.message);
      }
    }
    if (completed && !metaSent) {
      send('meta', { provider: selected.provider, model: selected.model, reason: selected.reason });
      metaSent = true;
    }
    if (!fullText) throw new Error('The model returned an empty answer. Try again.');
    await pool.query('INSERT INTO messages(chat_id,user_id,role,content,model) VALUES($1,$2,\'assistant\',$3,$4)', [chatId, req.session.userId, fullText, `${selected.provider}:${selected.model}`]);
    await pool.query('UPDATE chats SET updated_at=NOW() WHERE id=$1', [chatId]);
    send('done', { ok: true });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Generation failed:', error.message);
      send('error', { message: error.message || 'The model could not answer right now.' });
    }
  } finally {
    res.end();
  }
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
app.use(express.static('public', { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(fileURLToPath(new URL('./public/index.html', import.meta.url))));

app.listen(port, () => console.log(`Luma is listening on ${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await pool.end();
    process.exit(0);
  });
}

