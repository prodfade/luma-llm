const $ = selector => document.querySelector(selector);
const ui = {
  authScreen: $('#authScreen'), appShell: $('#appShell'), authForm: $('#authForm'), authEmail: $('#authEmail'),
  authPassword: $('#authPassword'), authTitle: $('#authTitle'), authCopy: $('#authCopy'), authEyebrow: $('#authEyebrow'),
  authSubmit: $('#authSubmit'), authError: $('#authError'), authSwitch: $('#authSwitch'), switchLabel: $('#switchLabel'),
  historyList: $('#historyList'), historyCount: $('#historyCount'), emptyHistory: $('#emptyHistory'), chatSearch: $('#chatSearch'),
  newChat: $('#newChat'), sidebar: $('#sidebar'), sidebarClose: $('#sidebarClose'), menuButton: $('#menuButton'), scrim: $('#scrim'),
  welcomeView: $('#welcomeView'), messages: $('#messages'), composerForm: $('#composerForm'), messageInput: $('#messageInput'),
  imageInput: $('#imageInput'), uploadImageButton: $('#uploadImageButton'), attachmentPreview: $('#attachmentPreview'),
  sendButton: $('#sendButton'), modelSelect: $('#modelSelect'), modelPicker: $('#modelPicker'), modelTrigger: $('#modelTrigger'),
  modelMenu: $('#modelMenu'), modelLabel: $('#modelLabel'), modelOptions: [...document.querySelectorAll('.model-option')],
  modelHint: $('#modelHint'), themeToggle: $('#themeToggle'),
  settingsButton: $('#settingsButton'), settingsDialog: $('#settingsDialog'), groqStatus: $('#groqStatus'), geminiStatus: $('#geminiStatus'), axforgeStatus: $('#axforgeStatus'),
  userEmail: $('#userEmail'), userAvatar: $('#userAvatar'), profileMenu: $('#profileMenu'), profilePopover: $('#profilePopover'),
  signOut: $('#signOut')
};

const state = { csrfToken: '', user: null, chats: [], activeChatId: null, authMode: 'login', providers: { groq: false, gemini: false, axforge: false }, sending: false, pendingImages: [] };
const safeText = value => String(value ?? '');

function setTheme(theme) {
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem('luma-theme-choice', theme);
  ui.themeToggle.querySelector('.theme-icon').textContent = resolved === 'dark' ? '☾' : '☼';
  ui.themeToggle.setAttribute('aria-label', resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('active', button.dataset.themeChoice === theme));
}

function renderAuthMode() {
  const login = state.authMode === 'login';
  ui.authEyebrow.textContent = login ? 'YOUR AI, YOUR SPACE' : 'A SPACE OF YOUR OWN';
  ui.authTitle.textContent = login ? 'A little more you.' : 'Let’s make it yours.';
  ui.authCopy.textContent = login ? 'Sign in to pick up where your thinking left off.' : 'Create an account to keep your chats close.';
  ui.authSubmit.innerHTML = login ? 'Sign in <span>→</span>' : 'Create account <span>→</span>';
  ui.switchLabel.textContent = login ? 'New around here?' : 'Already have an account?';
  ui.authSwitch.textContent = login ? 'Create an account' : 'Sign in';
  ui.authPassword.autocomplete = login ? 'current-password' : 'new-password';
  ui.authPassword.placeholder = login ? 'Your password' : 'At least 10 characters';
  ui.authError.textContent = '';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) headers.set('X-CSRF-Token', state.csrfToken);
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function enterApp(user, providers = state.providers) {
  state.user = user;
  state.providers = providers;
  ui.authScreen.hidden = true;
  ui.appShell.hidden = false;
  ui.userEmail.textContent = user.email;
  ui.userAvatar.textContent = user.email.slice(0, 1).toUpperCase();
  ui.groqStatus.textContent = providers.groq ? 'Connected' : 'Add in Vercel';
  ui.geminiStatus.textContent = providers.gemini ? 'Connected' : 'Add in Vercel';
  ui.axforgeStatus.textContent = providers.axforge ? 'Connected' : 'Add in Vercel';
  ui.groqStatus.classList.toggle('configured', providers.groq);
  ui.geminiStatus.classList.toggle('configured', providers.gemini);
  ui.axforgeStatus.classList.toggle('configured', providers.axforge);
}

function enterAuth() {
  state.user = null;
  ui.appShell.hidden = true;
  ui.authScreen.hidden = false;
  ui.authEmail.value = '';
  ui.authPassword.value = '';
  renderAuthMode();
}

async function boot() {
  setTheme(localStorage.getItem('luma-theme-choice') || 'system');
  try {
    const session = await api('/api/session');
    state.csrfToken = session.csrfToken;
    if (session.user) {
      enterApp(session.user, session.providers);
      await loadChats();
    } else enterAuth();
  } catch (error) {
    enterAuth();
    ui.authError.textContent = error.message;
  }
}

ui.authSwitch.addEventListener('click', () => {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  renderAuthMode();
});

ui.authForm.addEventListener('submit', async event => {
  event.preventDefault();
  ui.authSubmit.disabled = true;
  ui.authError.textContent = '';
  const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify({ email: ui.authEmail.value, password: ui.authPassword.value }) });
    state.csrfToken = result.csrfToken;
    enterApp(result.user, result.providers);
    await loadChats();
  } catch (error) {
    ui.authError.textContent = error.message;
  } finally {
    ui.authSubmit.disabled = false;
  }
});

async function loadChats() {
  const { chats } = await api('/api/chats');
  state.chats = chats;
  renderHistory();
}

function renderHistory() {
  const filter = ui.chatSearch.value.trim().toLowerCase();
  const visibleChats = state.chats.filter(chat => chat.title.toLowerCase().includes(filter) || (chat.preview || '').toLowerCase().includes(filter));
  ui.historyList.replaceChildren();
  ui.historyCount.textContent = state.chats.length;
  ui.emptyHistory.hidden = visibleChats.length > 0;
  ui.emptyHistory.querySelector('p').textContent = filter ? 'No conversations match that search.' : 'Your conversations will find a home here.';
  for (const chat of visibleChats) {
    const row = document.createElement('div');
    row.className = `history-item${chat.id === state.activeChatId ? ' active' : ''}`;
    const open = document.createElement('button');
    open.className = 'history-item-open';
    open.type = 'button';
    open.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;flex:1;border:0;padding:0;background:transparent;color:inherit;text-align:left;font:inherit';
    open.innerHTML = '<span class="history-glyph">▤</span>';
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = chat.title;
    open.append(title);
    open.addEventListener('click', () => openChat(chat.id));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'history-delete'; remove.title = 'Delete conversation'; remove.setAttribute('aria-label', `Delete ${chat.title}`); remove.textContent = '×';
    remove.addEventListener('click', async event => {
      event.stopPropagation();
      if (!confirm(`Delete “${chat.title}”?`)) return;
      try {
        await api(`/api/chats/${chat.id}`, { method: 'DELETE' });
        if (state.activeChatId === chat.id) resetChat();
        await loadChats();
      } catch (error) { alert(error.message); }
    });
    row.append(open, remove);
    ui.historyList.append(row);
  }
}

async function createChat() {
  const { chat } = await api('/api/chats', { method: 'POST', body: '{}' });
  state.activeChatId = chat.id;
  state.chats.unshift({ ...chat, preview: '' });
  renderHistory();
  showWelcome();
  closeSidebar();
  ui.messageInput.focus();
}

function showWelcome() {
  ui.welcomeView.hidden = false;
  ui.messages.hidden = true;
  ui.messages.replaceChildren();
}

function resetChat() {
  state.activeChatId = null;
  showWelcome();
  renderHistory();
}

async function openChat(chatId) {
  try {
    const { chat, messages } = await api(`/api/chats/${chatId}`);
    state.activeChatId = chat.id;
    ui.welcomeView.hidden = true;
    ui.messages.hidden = false;
    ui.messages.replaceChildren();
    for (const message of messages) appendMessage(message.role, message.content, { model: message.model, timestamp: message.created_at, attachments: message.attachments || [] });
    renderHistory();
    scrollConversation();
    closeSidebar();
  } catch (error) { toast(error.message); }
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

function markdown(value) {
  const source = escapeHtml(value).replace(/\r/g, '');
  const blocks = [];
  const protectedSource = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_all, language, code) => {
    const placeholder = `@@BLOCK${blocks.length}@@`;
    blocks.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${code.trimEnd()}</code></pre>`);
    return placeholder;
  });
  const lines = protectedSource.split('\n');
  let result = '';
  let listOpen = false;
  const closeList = () => { if (listOpen) { result += '</ul>'; listOpen = false; } };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const block = line.match(/^@@BLOCK(\d+)@@$/);
    if (block) { closeList(); result += blocks[Number(block[1])]; continue; }
    const list = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (list) { if (!listOpen) { result += '<ul>'; listOpen = true; } result += `<li>${inlineMarkup(list[1])}</li>`; continue; }
    closeList();
    if (!line) continue;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = Math.min(3, heading[1].length + 1); result += `<h${level}>${inlineMarkup(heading[2])}</h${level}>`; continue; }
    result += `<p>${inlineMarkup(line)}</p>`;
  }
  closeList();
  return result;
}

function inlineMarkup(line) {
  return line
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<em>$2</em>')
    .replace(/\[(.+?)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function appendMessage(role, content, meta = {}) {
  ui.welcomeView.hidden = true;
  ui.messages.hidden = false;
  const row = document.createElement('article');
  row.className = `message-row ${role}`;
  const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = role === 'assistant' ? '✳' : state.user.email.slice(0, 1).toUpperCase();
  const main = document.createElement('div'); main.className = 'message-main';
  const head = document.createElement('div'); head.className = 'message-head';
  const name = document.createElement('strong'); name.textContent = role === 'assistant' ? 'Luma' : 'You';
  head.append(name);
  if (role === 'assistant' && meta.model) {
    const model = document.createElement('span'); model.className = 'message-meta'; model.textContent = meta.model.replace(/^groq:/, 'Groq · ').replace(/^gemini:/, 'Gemini · ').replace(/^axforge:/, 'Qwen · AxForge · '); head.append(model);
  }
  const bubble = document.createElement('div'); bubble.className = 'message-bubble';
  if (meta.attachments?.length) renderMessageImages(bubble, meta.attachments);
  if (content) bubble.insertAdjacentHTML('beforeend', markdown(content));
  main.append(head, bubble);
  if (role === 'assistant' && content) {
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(content); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); });
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Regenerate'; retry.addEventListener('click', regenerateLast);
    actions.append(copy, retry); main.append(actions);
  }
  row.append(avatar, main);
  ui.messages.append(row);
  return { row, bubble, main };
}

function renderMessageImages(container, attachments) {
  const gallery = document.createElement('div'); gallery.className = 'message-images';
  for (const attachment of attachments) {
    if (!attachment.dataUrl || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(attachment.dataUrl)) continue;
    const link = document.createElement('a'); link.className = 'message-image'; link.href = attachment.dataUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const image = document.createElement('img'); image.src = attachment.dataUrl; image.alt = attachment.name || 'Uploaded image'; image.loading = 'lazy';
    link.append(image); gallery.append(link);
  }
  if (gallery.childElementCount) container.append(gallery);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  ui.attachmentPreview.replaceChildren();
  ui.attachmentPreview.hidden = state.pendingImages.length === 0;
  for (const attachment of state.pendingImages) {
    const card = document.createElement('div'); card.className = 'attachment-preview-item';
    const image = document.createElement('img'); image.src = attachment.dataUrl; image.alt = attachment.name; image.title = attachment.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'attachment-remove'; remove.setAttribute('aria-label', `Remove ${attachment.name}`); remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.pendingImages = state.pendingImages.filter(item => item.id !== attachment.id);
      renderImagePreviews(); resizeComposer();
    });
    card.append(image, remove); ui.attachmentPreview.append(card);
  }
}

function scrollConversation() {
  requestAnimationFrame(() => ui.conversationView.scrollTo({ top: ui.conversationView.scrollHeight, behavior: 'smooth' }));
}

function toast(message) {
  let notice = document.querySelector('.toast');
  if (!notice) { notice = document.createElement('div'); notice.className = 'toast'; document.body.append(notice); }
  notice.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => notice.remove(), 3200);
}

async function submitMessage(message = ui.messageInput.value, attachments = state.pendingImages) {
  const text = message.trim();
  if ((!text && !attachments.length) || state.sending) return;
  if (!state.activeChatId) {
    try { await createChat(); } catch (error) { toast(error.message); return; }
  }
  state.sending = true;
  const sentImages = [...attachments];
  if (attachments === state.pendingImages) { state.pendingImages = []; renderImagePreviews(); }
  ui.messageInput.value = '';
  resizeComposer();
  ui.sendButton.disabled = true;
  appendMessage('user', text, { attachments: sentImages });
  const assistant = appendMessage('assistant', '');
  assistant.bubble.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
  let fullText = '';
  let gotMeta = false;
  try {
    const response = await fetch(`/api/chats/${state.activeChatId}/messages`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken },
      body: JSON.stringify({ message: text, model: ui.modelSelect.value, attachments: sentImages.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })) })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'Could not reach Luma. Please try again.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const raw of events) {
        const eventName = raw.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim();
        const dataLine = raw.split(/\r?\n/).find(line => line.startsWith('data:'))?.slice(5).trim();
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine);
        if (eventName === 'meta') {
          gotMeta = true;
          const provider = payload.provider === 'groq' ? 'Groq' : payload.provider === 'gemini' ? 'Gemini' : 'Qwen · AxForge';
          const tag = document.createElement('span'); tag.className = 'message-meta'; tag.textContent = `${provider} · ${payload.reason}`;
          assistant.row.querySelector('.message-head').append(tag);
          ui.modelHint.textContent = `${provider} · ${payload.reason}`;
        }
        if (eventName === 'delta') {
          fullText += payload.text;
          assistant.bubble.innerHTML = markdown(fullText);
          scrollConversation();
        }
        if (eventName === 'error') throw new Error(payload.message || 'The model could not answer right now.');
      }
      if (done) break;
    }
    if (!fullText) throw new Error('The model returned an empty answer. Try again.');
    addMessageActions(assistant, fullText);
    await loadChats();
    renderHistory();
  } catch (error) {
    if (fullText) {
      assistant.bubble.innerHTML = markdown(fullText);
      const warning = document.createElement('div'); warning.className = 'response-error'; warning.textContent = error.message;
      assistant.bubble.append(warning);
      addMessageActions(assistant, fullText);
    } else {
      assistant.row.remove();
      const alertRow = appendMessage('assistant', '');
      alertRow.bubble.innerHTML = '';
      const warning = document.createElement('div'); warning.className = 'response-error'; warning.textContent = error.message;
      alertRow.bubble.append(warning);
    }
    renderHistory();
  } finally {
    state.sending = false;
    ui.sendButton.disabled = !ui.messageInput.value.trim() && !state.pendingImages.length;
    ui.messageInput.focus();
    scrollConversation();
  }
}

function addMessageActions(assistant, content) {
  if (assistant.main.querySelector('.message-actions')) return;
  const actions = document.createElement('div'); actions.className = 'message-actions';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(content); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); });
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Regenerate'; retry.addEventListener('click', regenerateLast);
  actions.append(copy, retry); assistant.main.append(actions);
}

async function regenerateLast() {
  if (!state.activeChatId || state.sending) return;
  try {
    const { messages } = await api(`/api/chats/${state.activeChatId}`);
    const last = [...messages].reverse().find(message => message.role === 'user');
    if (last) await submitMessage(last.content, last.attachments || []);
  } catch (error) { toast(error.message); }
}

function resizeComposer() {
  ui.messageInput.style.height = 'auto';
  ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 175)}px`;
  ui.sendButton.disabled = state.sending || (!ui.messageInput.value.trim() && !state.pendingImages.length);
}

function closeModelMenu(restoreFocus = false) {
  ui.modelMenu.hidden = true;
  ui.modelPicker.classList.remove('open');
  ui.modelTrigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) ui.modelTrigger.focus();
}

function openModelMenu(focusSelected = true) {
  ui.modelMenu.hidden = false;
  ui.modelPicker.classList.add('open');
  ui.modelTrigger.setAttribute('aria-expanded', 'true');
  if (focusSelected) ui.modelOptions.find(option => option.dataset.model === ui.modelSelect.value)?.focus();
}

function chooseModel(value) {
  const model = {
    auto: { label: 'Auto · choose for me', hint: 'Auto picks a model for each prompt' },
    groq: { label: 'Groq · reasoning & code', hint: 'Groq · code & reasoning' },
    gemini: { label: 'Gemini · everyday & creative', hint: 'Gemini · everyday & creative' },
    axforge: { label: 'Qwen · AxForge', hint: 'Qwen · AxForge' }
  }[value];
  if (!model) return;
  ui.modelSelect.value = value;
  ui.modelLabel.textContent = model.label;
  ui.modelHint.textContent = model.hint;
  ui.modelOptions.forEach(option => option.setAttribute('aria-selected', String(option.dataset.model === value)));
  closeModelMenu(true);
}

ui.composerForm.addEventListener('submit', event => { event.preventDefault(); submitMessage(); });
ui.messageInput.addEventListener('input', resizeComposer);
ui.uploadImageButton.addEventListener('click', () => ui.imageInput.click());
ui.imageInput.addEventListener('change', async () => {
  const acceptedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const files = [...ui.imageInput.files];
  ui.imageInput.value = '';
  if (state.pendingImages.length + files.length > 8) { toast('Add up to 8 images per message.'); return; }
  const validFiles = files.filter(file => acceptedTypes.includes(file.type));
  if (validFiles.length !== files.length) toast('Use PNG, JPEG, WebP, or GIF images.');
  const totalSize = state.pendingImages.reduce((sum, file) => sum + file.size, 0) + validFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 6 * 1024 * 1024) { toast('Keep images under 6 MB total per message.'); return; }
  try {
    state.pendingImages.push(...await Promise.all(validFiles.map(readImage)));
    renderImagePreviews(); resizeComposer();
  } catch (error) { toast(error.message); }
});
ui.messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitMessage(); }
});
ui.modelTrigger.addEventListener('click', () => ui.modelMenu.hidden ? openModelMenu() : closeModelMenu());
ui.modelTrigger.addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    openModelMenu();
    if (event.key === 'ArrowUp') ui.modelOptions.at(-1)?.focus();
  }
});
ui.modelOptions.forEach((option, index) => {
  option.addEventListener('click', () => chooseModel(option.dataset.model));
  option.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeModelMenu(true); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      ui.modelOptions[(index + step + ui.modelOptions.length) % ui.modelOptions.length].focus();
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      ui.modelOptions[event.key === 'Home' ? 0 : ui.modelOptions.length - 1].focus();
    }
  });
});
ui.modelPicker.addEventListener('focusout', () => requestAnimationFrame(() => {
  if (!ui.modelPicker.contains(document.activeElement)) closeModelMenu();
}));
document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => {
  ui.messageInput.value = button.dataset.prompt;
  resizeComposer();
  ui.messageInput.focus();
}));
ui.newChat.addEventListener('click', createChat);
ui.chatSearch.addEventListener('input', renderHistory);
ui.themeToggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
ui.settingsButton.addEventListener('click', () => ui.settingsDialog.showModal());
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
ui.profileMenu.addEventListener('click', () => { ui.profilePopover.hidden = !ui.profilePopover.hidden; });
document.addEventListener('click', event => {
  if (!ui.profilePopover.contains(event.target) && !ui.profileMenu.contains(event.target)) ui.profilePopover.hidden = true;
  if (!ui.modelPicker.contains(event.target)) closeModelMenu();
});
ui.signOut.addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (error) { toast(error.message); return; }
  state.csrfToken = '';
  state.chats = [];
  state.activeChatId = null;
  state.authMode = 'login';
  enterAuth();
});
ui.menuButton.addEventListener('click', () => { ui.sidebar.classList.add('open'); ui.scrim.classList.add('visible'); });
ui.sidebarClose.addEventListener('click', closeSidebar);
ui.scrim.addEventListener('click', closeSidebar);
function closeSidebar() { ui.sidebar.classList.remove('open'); ui.scrim.classList.remove('visible'); }
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); }
  if ((event.metaKey || event.ctrlKey) && event.key === '/') { event.preventDefault(); ui.chatSearch.focus(); }
  if (event.key === 'Escape') { closeSidebar(); if (!ui.modelMenu.hidden) closeModelMenu(true); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (localStorage.getItem('luma-theme-choice') === 'system') setTheme('system'); });

boot();

