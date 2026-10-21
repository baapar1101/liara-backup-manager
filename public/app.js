let csrf = '';
let currentBackups = [];
let lastKnownBackupState = null;
let bannerTimerInterval = null;
let backupStartTime = null;

const $ = (id) => document.getElementById(id);

// --- Toast Notification System ---
const ToastIcons = {
  success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
};

function showToast(title, message = '', type = 'info', duration = 5000) {
  const container = $('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'toast-icon';
  iconDiv.innerHTML = ToastIcons[type] || ToastIcons.info;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'toast-content';

  const titleEl = document.createElement('h4');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;

  contentDiv.appendChild(titleEl);

  if (message) {
    const msgEl = document.createElement('p');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;
    contentDiv.appendChild(msgEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'بستن اعلان');
  closeBtn.innerHTML = '&times;';

  const progress = document.createElement('div');
  progress.className = 'toast-progress';
  progress.style.animationDuration = `${duration}ms`;

  toast.appendChild(iconDiv);
  toast.appendChild(contentDiv);
  toast.appendChild(closeBtn);
  if (duration > 0) {
    toast.appendChild(progress);
  }

  container.appendChild(toast);

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.classList.add('toast-closing');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  };

  closeBtn.onclick = dismiss;

  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }
}

// --- API Request Helper ---
async function req(url, method = 'GET', body = undefined) {
  const options = {
    method,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf
    }
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error('خطا در برقراری ارتباط با سرور: ' + err.message);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: 'پاسخ نامعتبر از سرور دریافت شد' };
  }

  if (!res.ok) {
    throw new Error(data.error || `خطای سرور (${res.status})`);
  }

  return data;
}

// --- Formatting Helpers ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('fa-IR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return isoString;
  }
}

// --- Tabs Management ---
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((btn) => {
    btn.onclick = () => {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach((content) => {
        content.hidden = content.id !== targetId;
      });
    };
  });
}

// --- Settings Management ---
const settingsKeys = [
  'databaseId', 'liaraToken', 'apiBase', 'sqlHost', 'sqlPort',
  'sqlDatabase', 'sqlUser', 'sqlPassword', 'sqlEncrypt', 'sqlTrustCertificate',
  'scheduleEnabled', 'cronExpression', 'timezone', 'retention',
  'telegramEnabled', 'telegramToken', 'telegramChatId', 'proxyUrl', 'sendOnManual'
];
const sensitiveKeys = ['liaraToken', 'sqlPassword', 'telegramToken'];

function extractFormValues() {
  const data = {};
  const forms = [$('settingsFormConnections'), $('settingsFormSchedule')];

  for (const form of forms) {
    if (!form) continue;
    for (const key of settingsKeys) {
      const el = form.elements.namedItem(key);
      if (!el) continue;
      if (el.type === 'checkbox') {
        data[key] = el.checked;
      } else {
        data[key] = el.value;
      }
    }
  }

  if (data.sqlPort !== undefined) data.sqlPort = Number(data.sqlPort) || 30179;
  if (data.retention !== undefined) data.retention = Number(data.retention) || 14;

  for (const k of sensitiveKeys) {
    if (!data[k]) delete data[k];
  }

  return data;
}

async function loadSettings() {
  try {
    const s = await req('/api/settings');
    const forms = [$('settingsFormConnections'), $('settingsFormSchedule')];

    for (const form of forms) {
      if (!form) continue;
      for (const k of settingsKeys) {
        const el = form.elements.namedItem(k);
        if (!el) continue;
        if (el.type === 'checkbox') {
          el.checked = !!s[k];
        } else {
          el.value = s[k] ?? '';
        }
        if (sensitiveKeys.includes(k)) {
          el.placeholder = s[k + 'Set'] ? 'ثبت شده (برای تغییر وارد کنید)' : 'ثبت نشده';
        }
      }
    }

    // Update Overview Stat Cards with settings info
    if ($('statAutoBackup')) {
      $('statAutoBackup').textContent = s.scheduleEnabled ? 'فعال' : 'غیرفعال';
      $('statAutoBackup').style.color = s.scheduleEnabled ? 'var(--status-success)' : 'var(--text-muted)';
    }
    if ($('statCronHint')) {
      $('statCronHint').textContent = s.cronExpression || '0 3 * * *';
    }
    if ($('statRetentionHint')) {
      $('statRetentionHint').textContent = `سقف نگهداری: ${s.retention || 14} فایل`;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings(e) {
  if (e) e.preventDefault();
  const btn = e?.target?.querySelector('button[type=submit]');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'در حال ذخیره‌سازی...';
  }

  try {
    const values = extractFormValues();
    await req('/api/settings', 'PUT', values);
    await loadSettings();
    showToast('تنظیمات ذخیره شد', 'اطلاعات با موفقیت به‌روزرسانی شد.', 'success');
  } catch (err) {
    showToast('خطا در ذخیره تنظیمات', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// --- Files List Rendering ---
function renderFiles(files) {
  currentBackups = files;
  const container = $('files');
  const countBadge = $('fileCountBadge');
  const query = ($('fileSearch')?.value || '').trim().toLowerCase();

  const filtered = query
    ? files.filter((f) => f.name.toLowerCase().includes(query))
    : files;

  if (countBadge) {
    countBadge.textContent = `${files.length} فایل (${formatBytes(files.reduce((acc, f) => acc + (f.size || 0), 0))})`;
  }

  if ($('statFileCount')) {
    $('statFileCount').textContent = files.length.toLocaleString('fa-IR');
  }
  if ($('statTotalSize')) {
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    $('statTotalSize').textContent = formatBytes(totalBytes);
  }

  // Update latest download button state
  const latestBtn = $('latestDownloadBtn');
  if (latestBtn) {
    if (files.length === 0) {
      latestBtn.classList.add('disabled');
      latestBtn.setAttribute('aria-disabled', 'true');
      latestBtn.style.opacity = '0.5';
      latestBtn.style.pointerEvents = 'none';
    } else {
      latestBtn.classList.remove('disabled');
      latestBtn.removeAttribute('aria-disabled');
      latestBtn.style.opacity = '1';
      latestBtn.style.pointerEvents = 'auto';
    }
  }

  container.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
      </div>
      <p>${query ? 'فایلی مطابق با عبارت جستجو یافت نشد.' : 'هنوز فایل بکاپی روی دیسک ذخیره نشده است.'}</p>
    `;
    container.appendChild(empty);
    return;
  }

  for (const f of filtered) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const lead = document.createElement('div');
    lead.className = 'file-lead';

    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

    const details = document.createElement('div');
    details.className = 'file-details';

    const name = document.createElement('div');
    name.className = 'file-name tabular-nums';
    name.textContent = f.name;

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.innerHTML = `
      <span class="tabular-nums">${formatBytes(f.size)}</span>
      <span aria-hidden="true">·</span>
      <span>${formatDate(f.created)}</span>
    `;

    details.appendChild(name);
    details.appendChild(meta);
    lead.appendChild(icon);
    lead.appendChild(details);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const dlLink = document.createElement('a');
    dlLink.className = 'btn btn-secondary btn-sm';
    dlLink.href = '/api/backups/' + encodeURIComponent(f.name) + '/download';
    dlLink.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>دانلود</span>`;

    const telegramBtn = document.createElement('button');
    telegramBtn.type = 'button';
    telegramBtn.className = 'btn btn-secondary btn-sm';
    telegramBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><span>ارسال تلگرام</span>`;
    telegramBtn.onclick = async () => {
      telegramBtn.disabled = true;
      telegramBtn.textContent = 'در حال ارسال...';
      try {
        await req('/api/backups/' + encodeURIComponent(f.name) + '/telegram', 'POST', {});
        showToast('ارسال شد', `فایل ${f.name} به تلگرام فرستاده شد.`, 'success');
      } catch (e) {
        showToast('خطا در ارسال تلگرام', e.message, 'error');
      } finally {
        telegramBtn.disabled = false;
        telegramBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><span>ارسال تلگرام</span>`;
      }
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    deleteBtn.title = 'حذف فایل از سرور';
    deleteBtn.onclick = async () => {
      if (!confirm(`آیا از حذف فایل ${f.name} اطمینان دارید؟`)) return;
      deleteBtn.disabled = true;
      try {
        await req('/api/backups/' + encodeURIComponent(f.name), 'DELETE');
        showToast('فایل حذف شد', `${f.name} از حافظه سرور پاک شد.`, 'info');
        await refresh();
      } catch (e) {
        showToast('خطا در حذف فایل', e.message, 'error');
        deleteBtn.disabled = false;
      }
    };

    actions.appendChild(dlLink);
    actions.appendChild(telegramBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(lead);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

function renderRemoteBackups(backups, error = '') {
  const container = $('remoteBackups');
  const count = $('remoteBackupCount');
  if (!container) return;
  container.innerHTML = '';
  if (count) count.textContent = `${backups.length.toLocaleString('fa-IR')} بکاپ`;

  if (error || backups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const text = document.createElement('p');
    text.textContent = error || 'بکاپی در Liara موجود نیست.';
    empty.appendChild(text);
    container.appendChild(empty);
    return;
  }

  for (const backup of backups) {
    const item = document.createElement('div');
    item.className = 'file-item remote-file-item';
    const lead = document.createElement('div');
    lead.className = 'file-lead';
    const icon = document.createElement('div');
    icon.className = 'file-icon cloud-file-icon';
    icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path><polyline points="8 15 12 19 16 15"></polyline><line x1="12" y1="19" x2="12" y2="10"></line></svg>`;
    const details = document.createElement('div');
    details.className = 'file-details';
    const name = document.createElement('div');
    name.className = 'file-name tabular-nums';
    name.textContent = backup.name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const kind = backup.name.startsWith('daily/') ? 'روزانه' : backup.name.startsWith('manual/') ? 'دستی' : 'ابری';
    meta.innerHTML = `<span class="backup-kind">${kind}</span><span aria-hidden="true">·</span><span class="tabular-nums">${formatBytes(backup.size || 0)}</span><span aria-hidden="true">·</span><span>${formatDate(backup.lastModified)}</span>`;
    details.append(name, meta);
    lead.append(icon, details);

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const download = document.createElement('a');
    download.className = 'btn btn-primary btn-sm';
    download.href = '/api/remote-backups/download?name=' + encodeURIComponent(backup.name);
    download.target = '_blank';
    download.rel = 'noopener';
    download.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>دانلود مستقیم</span>`;
    actions.appendChild(download);
    item.append(lead, actions);
    container.appendChild(item);
  }
}

// --- Live Backup Banner & Status ---
function updateRunningBanner(status) {
  const banner = $('runningBanner');
  const elapsedEl = $('bannerElapsed');
  const titleEl = $('bannerTitle');
  const detailEl = $('bannerDetail');

  if (status.state === 'running') {
    banner.style.display = 'flex';
    titleEl.textContent = 'بکاپ در حال اجرا است...';
    detailEl.textContent = status.message || 'ارتباط با API لیارا و آماده‌سازی فایل بکاپ';

    if (!backupStartTime && status.started) {
      backupStartTime = new Date(status.started).getTime();
    } else if (!backupStartTime) {
      backupStartTime = Date.now();
    }

    if (!bannerTimerInterval) {
      bannerTimerInterval = setInterval(() => {
        if (!backupStartTime) return;
        const diffSec = Math.floor((Date.now() - backupStartTime) / 1000);
        if (elapsedEl) {
          elapsedEl.textContent = `${diffSec} ثانیه سپری شده`;
        }
      }, 1000);
    }
  } else {
    banner.style.display = 'none';
    if (bannerTimerInterval) {
      clearInterval(bannerTimerInterval);
      bannerTimerInterval = null;
    }
    backupStartTime = null;
  }
}

// --- State and Backups Refresh ---
async function refresh() {
  try {
    const [status, files, remoteResult] = await Promise.all([
      req('/api/status'),
      req('/api/backups'),
      req('/api/remote-backups').then(backups => ({ backups, error: '' })).catch(error => ({ backups: [], error: error.message }))
    ]);

    // Top status indicator badge
    const badge = $('stateBadge');
    const stateText = $('state');
    badge.className = `status-indicator ${status.state}`;

    let persianState = 'آماده';
    if (status.state === 'running') persianState = 'در حال بکاپ';
    else if (status.state === 'success') persianState = 'موفق';
    else if (status.state === 'error') persianState = 'خطا در بکاپ';
    stateText.textContent = persianState;

    if ($('statEngineState')) {
      $('statEngineState').textContent = persianState;
      $('statEngineState').style.color =
        status.state === 'running' ? 'var(--status-warning)' :
        status.state === 'error' ? 'var(--status-error)' :
        'var(--text-primary)';
    }

    if ($('statEngineHint')) {
      $('statEngineHint').textContent = status.message || 'سیستم در انتظار عملیات';
    }

    // Backup button state
    const backupBtn = $('backup');
    if (backupBtn) {
      backupBtn.disabled = status.state === 'running';
      if (status.state === 'running') {
        backupBtn.innerHTML = `<span class="operation-spinner" style="width:14px;height:14px;border-width:2px;"></span><span>در حال پردازش...</span>`;
      } else {
        backupBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span>شروع بکاپ فوری</span>`;
      }
    }

    // Status text in card
    const statusTextEl = $('statusText');
    if (statusTextEl) {
      const timeStr = status.started ? ` (${formatDate(status.started)})` : '';
      statusTextEl.textContent = (status.message || 'هنوز بکاپی اجرا نشده') + timeStr;
    }

    // Running banner
    updateRunningBanner(status);

    // Detect state changes and show notifications
    if (lastKnownBackupState && lastKnownBackupState.state === 'running') {
      if (status.state === 'success') {
        showToast(
          'بکاپ با موفقیت انجام شد',
          `فایل ${status.lastFile || 'جدید'} با موفقیت ذخیره شد.`,
          'success',
          7000
        );
      } else if (status.state === 'error') {
        showToast(
          'خطا در ایجاد بکاپ',
          status.message || 'عملیات با خطا مواجه شد.',
          'error',
          8000
        );
      }
    }
    lastKnownBackupState = status;

    // Render files
    renderFiles(files);
    renderRemoteBackups(remoteResult.backups, remoteResult.error);
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

// --- App Initialization ---
async function init() {
  try {
    const me = await req('/api/me');
    csrf = me.csrf;
    $('login').hidden = true;
    $('workspace').hidden = false;
    $('headerActions').hidden = false;

    setupTabs();
    await Promise.all([loadSettings(), refresh()]);
  } catch {
    $('login').hidden = false;
    $('workspace').hidden = true;
    $('headerActions').hidden = true;
    $('stateBadge').className = 'status-indicator idle';
    $('state').textContent = 'نیاز به ورود';
  }
}

// --- Event Handlers ---
// Quick Credential Filler for Dev/Preview
const fillBtn = $('fillDefaultCreds');
if (fillBtn) {
  fillBtn.onclick = () => {
    const input = $('adminPasswordInput');
    if (input) {
      input.value = 'admin12345678';
      input.focus();
    }
  };
}

// Login
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'در حال بررسی...';

  try {
    const res = await req('/api/login', 'POST', {
      password: e.target.password.value
    });
    csrf = res.csrf;
    e.target.reset();
    showToast('ورود موفق', 'به پنل مدیریت بکاپ خوش آمدید.', 'success');
    await init();
  } catch (err) {
    showToast('خطای ورود', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ورود به پنل';
  }
};

// Logout
$('logout').onclick = async () => {
  try {
    await req('/api/logout', 'POST', {});
    csrf = '';
    showToast('خروج', 'از حساب کاربری خارج شدید.', 'info');
    await init();
  } catch (err) {
    showToast('خطا در خروج', err.message, 'error');
  }
};

// Refresh button
$('refresh').onclick = () => {
  refresh().then(() => {
    showToast('به‌روزرسانی شد', 'وضعیت و لیست فایل‌ها با سرور همگام شد.', 'info', 2000);
  }).catch((e) => showToast('خطا', e.message, 'error'));
};

// Manual Backup Trigger
$('backup').onclick = async () => {
  try {
    await req('/api/backup', 'POST', {});
    showToast('درخواست بکاپ ارسال شد', 'فرایند بکاپ‌گیری آغاز گردید.', 'info');
    await refresh();
  } catch (e) {
    showToast('خطا در شروع بکاپ', e.message, 'error');
  }
};

// Settings Forms
const connForm = $('settingsFormConnections');
if (connForm) connForm.onsubmit = saveSettings;

const schedForm = $('settingsFormSchedule');
if (schedForm) schedForm.onsubmit = saveSettings;

// Test SQL Connection
$('testSql').onclick = async () => {
  const btn = $('testSql');
  const resultBox = $('sqlTestResult');
  btn.disabled = true;
  btn.innerHTML = `<span class="operation-spinner" style="width:13px;height:13px;border-width:2px;"></span><span>در حال تست اتصال...</span>`;
  resultBox.className = 'test-result-box';
  resultBox.style.display = 'none';

  try {
    const res = await req('/api/test-sql', 'POST', {});
    resultBox.className = 'test-result-box active success';
    resultBox.textContent = `اتصال با موفقیت برقرار شد. دیتابیس فعال: ${res.database || 'نامشخص'}`;
    resultBox.style.display = 'flex';
    showToast('اتصال SQL برقرار شد', `دیتابیس متصل: ${res.database || 'موفق'}`, 'success');
  } catch (e) {
    resultBox.className = 'test-result-box active error';
    resultBox.textContent = `خطا در برقراری اتصال SQL: ${e.message}`;
    resultBox.style.display = 'flex';
    showToast('خطای اتصال SQL', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span>تست اتصال مستقیم SQL</span>`;
  }
};

// Test Telegram
$('testTelegram').onclick = async () => {
  const btn = $('testTelegram');
  const resultBox = $('telegramTestResult');
  btn.disabled = true;
  btn.innerHTML = `<span class="operation-spinner" style="width:13px;height:13px;border-width:2px;"></span><span>در حال ارسال پیام...</span>`;
  resultBox.className = 'test-result-box';
  resultBox.style.display = 'none';

  try {
    await req('/api/test-telegram', 'POST', {});
    resultBox.className = 'test-result-box active success';
    resultBox.textContent = 'پیام آزمایشی با موفقیت به تلگرام ارسال گردید.';
    resultBox.style.display = 'flex';
    showToast('تلگرام متصل است', 'پیام آزمایشی به چت مقصد ارسال شد.', 'success');
  } catch (e) {
    resultBox.className = 'test-result-box active error';
    resultBox.textContent = `خطا در ارسال به تلگرام: ${e.message}`;
    resultBox.style.display = 'flex';
    showToast('خطای تلگرام', e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><span>ارسال پیام آزمایشی تلگرام</span>`;
  }
};

// Change Password
$('passwordForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'در حال تغییر...';

  try {
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    await req('/api/password', 'POST', { currentPassword, newPassword });
    form.reset();
    showToast('رمز عبور تغییر یافت', 'رمز جدید با موفقیت ذخیره شد.', 'success');
  } catch (err) {
    showToast('خطا در تغییر رمز', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'تغییر رمز عبور';
  }
};

// Live File Search
const searchInput = $('fileSearch');
if (searchInput) {
  searchInput.oninput = () => {
    renderFiles(currentBackups);
  };
}

// Background Polling (faster when running)
setInterval(() => {
  if (csrf) {
    refresh().catch(() => {});
  }
}, 8000);

// Initialize on load
init();
