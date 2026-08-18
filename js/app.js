/* YH英语通 v2：分级 + 遗忘曲线复习 + 阅读/完形 */
const D = window.ZHSB;
const WORDS = D.WORDS, GRAMMAR = D.GRAMMAR, READING = D.READING, CLOZE = D.CLOZE;
const LS = 'zhsb_v3';
const CATS = ['', '小学', '初中', '高中', '专升本·高频', '专升本·中频', '专升本·低频', '四级', '六级'];
const DIFF = ['', '基础', '初级', '中级', '高级']; // 阅读/完形难度
const SRS_DAYS = [1, 2, 4, 7, 15, 30]; // 遗忘曲线间隔（天），stage 0~5
const DAY = 86400000;

const $ = id => document.getElementById(id);
const wordCats = w => w[6] || [];
const catName = c => CATS[c] || '';
const diffName = d => DIFF[d] || '';
const levelName = d => DIFF[d] || ''; // 阅读/完形难度标签（兼容别名）
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function defaultState() {
  return {
    statuses: {}, learnedToday: {}, quiz: { n: 0, right: 0 }, wrong: [],
    streak: { last: '', n: 0 }, extraWords: [], srs: {},
    target: 20, targetShownDate: '', lastWord: {},
    favorites: [], customReading: [], customCloze: [], aiKey: '', aiStage: '', aiDiff: '基础',
    dark: false, learnLevel: 0, hiddenReadings: [], hiddenCloze: [], aiWordCache: {}
  };
}
let S = loadState();
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(LS)); return Object.assign(defaultState(), s || {}); }
  catch (e) { return defaultState(); }
}
function save() { localStorage.setItem(LS, JSON.stringify(S)); }
function words() {
  return WORDS.concat(S.extraWords.filter(w => !WORDS.some(x => x[0] === w[0])));
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function touchStreak() {
  const t = todayStr();
  if (S.streak.last === t) return;
  const y = new Date(Date.now() - DAY);
  const yt = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  S.streak.n = (S.streak.last === yt) ? S.streak.n + 1 : 1;
  S.streak.last = t; save();
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function migrate() {
  if (S.srs && Object.keys(S.srs).length) return;
  const keys = Object.keys(S.statuses || {});
  if (!keys.length) return;
  const now = Date.now();
  keys.forEach(k => {
    const st = S.statuses[k];
    S.srs[k] = { st: st === 2 ? 3 : (st === 1 ? 1 : 0), nx: now, last: now, wrong: 0 };
  });
  save();
}
migrate();

/* ---------- 遗忘曲线 ---------- */
function isMastered(w) { const s = S.srs[w[0]]; return !!(s && s.st >= 4); }
function dueWords() { return words().filter(w => { const s = S.srs[w[0]]; return s && s.nx <= Date.now(); }); }
function weakWords() { return words().filter(w => { const s = S.srs[w[0]]; return !s || s.st === 0; }); }
function srsRate(w, r) {
  const key = w[0];
  const cur = S.srs[key] || { st: 0, nx: 0, last: 0, wrong: 0 };
  const now = Date.now();
  if (r === 2) { cur.st = Math.min(5, cur.st + 1); cur.nx = now + SRS_DAYS[cur.st] * DAY; }
  else if (r === 1) { if (!S.srs[key]) cur.st = 0; cur.nx = now + DAY; }
  else { cur.st = 0; cur.nx = now + DAY; cur.wrong++; }
  cur.last = now;
  S.srs[key] = cur;
}
function recordLearn(w) {
  S.statuses[w[0]] = 2;
  const t = todayStr();
  S.learnedToday[t] = S.learnedToday[t] || [];
  if (S.learnedToday[t].indexOf(w[0]) < 0) S.learnedToday[t].push(w[0]);
}

/* ---------- 视图 ---------- */
function showView(v) {
  document.querySelectorAll('section.view').forEach(s => s.classList.remove('active'));
  $('view-' + v).classList.add('active');
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  if (v === 'learn') openLearn();
  if (v === 'practice') openPractice();
  if (v === 'quiz') openQuiz();
  if (v === 'fav') renderFavs();
  if (v === 'errors') openErrors();
  if (v === 'stats') openStats();
  $('hdrStreak').textContent = '🔥 ' + S.streak.n + ' 天';
}
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => showView(b.dataset.v));

/* ---------- 学习 ---------- */
let learnLevel = 0, learnMode = 'study', learnQueue = [], learnIdx = 0;
function openLearn() {
  learnLevel = (S.learnLevel >= 1 && S.learnLevel <= 8) ? S.learnLevel : 0;
  renderCal();
  renderLearnHead();
  renderLearn();
}
function levelSeg() {
  const opts = [{ v: 0, l: '全部' }].concat(CATS.slice(1).map((n, i) => ({ v: i + 1, l: n })));
  return opts.map(o => '<button class="' + (learnLevel === o.v ? 'on' : '') + '" onclick="setLearnLevel(' + o.v + ')">' + o.l + '</button>').join('');
}function setLearnLevel(l) { learnLevel = l; S.learnLevel = l; save(); learnMode = 'study'; renderLearnHead(); renderLearn(); }
// 恢复上次学习位置：按“上次学到的单词名”定位（队列变化不错位）
function restoreIdx() {
  const lw = S.lastWord[learnLevel];
  if (!lw || !learnQueue.length) { learnIdx = 0; return; }
  const i = learnQueue.findIndex(w => w[0] === lw);
  learnIdx = i >= 0 ? i : 0;
}
function savePos() {
  const w = learnQueue[learnIdx];
  if (w) S.lastWord[learnLevel] = w[0];
  save();
}
function renderLearnHead() {
  const done = (S.learnedToday[todayStr()] || []).length;
  const target = S.target || 20;
  $('lpText').textContent = '今日 ' + done + ' / 目标 ' + target;
  $('lpBar').style.width = Math.min(100, done / target * 100) + '%';
  $('dueCount').textContent = dueWords().length;
  renderCatPicker();
  const note = $('learnLevelNote');
  if (note) note.textContent = '已记住上次选择';
}
/* 近 7 天复习日历 */
function renderCal() {
  const row = $('calRow');
  if (!row) return;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    days.push(d);
  }
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  row.innerHTML = days.map(d => {
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(d0.getTime() + DAY);
    let cnt = 0;
    Object.keys(S.srs || {}).forEach(k => {
      const s = S.srs[k];
      if (s && s.nx >= d0.getTime() && s.nx < d1.getTime()) cnt++;
    });
    const isToday = ds === todayStr();
    const label = isToday ? '今天' : WK[d.getDay()];
    return '<div class="d ' + (isToday ? 'today' : '') + (cnt ? ' hot' : '') + '"><div class="w">' + label + '</div><div class="n">' + (cnt ? cnt + ' 词' : '—') + '</div></div>';
  }).join('');
}
function refreshCal() { renderCal(); }
function renderCatPicker() {
  const ws = words();
  $('catCurrent').innerHTML = '<span>' + (learnLevel === 0 ? '📚 全部' : '📚 ' + CATS[learnLevel]) + '</span><span class="caret">▼</span>';
  $('catMenu').innerHTML = [{ v: 0, l: '全部' }].concat(CATS.slice(1).map((n, i) => ({ v: i + 1, l: n })))
    .map(o => '<div class="cat-opt ' + (learnLevel === o.v ? 'on' : '') + '" onclick="pickCat(' + o.v + ')">' +
      '<span>' + o.l + '</span><span class="n">' + (o.v ? ws.filter(w => (w[6] || []).indexOf(o.v) >= 0).length : ws.length) + ' 词</span>' +
      (learnLevel === o.v ? '<span class="ck">✓</span>' : '') + '</div>').join('');
}
function toggleCatMenu() {
  const m = $('catMenu');
  m.classList.toggle('open');
  if (m.classList.contains('open')) renderCatPicker();
}
function pickCat(v) {
  $('catMenu').classList.remove('open');
  setLearnLevel(v);
}
/* ---------- 每日目标 ---------- */
function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}
function checkDailyTarget() {
  const t = todayStr();
  if (S.targetShownDate === t) return;
  const done = (S.learnedToday[t] || []).length;
  if (done >= (S.target || 20)) {
    S.targetShownDate = t;
    save();
    showToast('🎉 今日目标已达成（' + done + ' 词）！休息一下，明天继续 💪');
  }
}
function targetInc() { S.target = Math.min(500, (S.target || 20) + 5); save(); renderLearnHead(); }
function targetDec() { S.target = Math.max(5, (S.target || 20) - 5); save(); renderLearnHead(); }
function queueForLevel() {
  return words().filter(w => (learnLevel === 0 || (w[6] || []).indexOf(learnLevel) >= 0));
}
function startStudy() {
  learnMode = 'study';
  learnQueue = queueForLevel().filter(w => !isMastered(w));
  restoreIdx();
  $('learnDone').style.display = 'none';
  $('wCard').style.display = 'block';
  if (!learnQueue.length) { renderLearnDone(); return; }
  renderLearnCard();
}
function startReview() {
  const due = dueWords();
  if (!due.length) { alert('🎉 今天没有到期的复习词！'); return; }
  learnMode = 'review';
  learnQueue = due.sort((a, b) => (S.srs[a[0]].nx - S.srs[b[0]].nx));
  learnIdx = 0;
  $('learnDone').style.display = 'none';
  $('wCard').style.display = 'block';
  renderLearnCard();
}
function renderLearn() {
  if (learnMode === 'study') startStudy();
  else if (learnMode === 'fav' && learnQueue.length) renderLearnCard();
  else {
    const due = dueWords();
    if (!due.length) { learnMode = 'study'; startStudy(); } else startReview();
  }
}
function renderLearnCard() {
  const w = learnQueue[learnIdx];
  $('wWord').textContent = w[0];
  $('wIpa').textContent = w[1] || '';
  $('wPos').textContent = w[2] || '';
  $('wLv').textContent = catName((w[6] || [1])[0]);
  $('wMeaning').textContent = w[3];
  $('wEx').innerHTML = w[4] ? '“' + esc(w[4]) + '” <button class="icon-btn mini" data-say="' + esc(w[4]) + '" title="朗读例句">🔊</button>' : '';
  $('wExCn').textContent = w[5] || '';
  $('wDetail').style.display = 'none';
  $('wShow').style.display = 'block';
  $('wBtns').innerHTML =
    '<button class="btn btn-bad" onclick="rate(0)">😵 不认识</button>' +
    '<button class="btn btn-mid" onclick="rate(1)">🤔 模糊</button>' +
    '<button class="btn btn-ok" onclick="rate(2)">✅ 认识</button>';
  $('wBtns').style.display = 'none';
  $('wSpeak').onclick = () => speak(w[0]);
  updateFavBtn(w);
}
function updateFavBtn(w) {
  const b = $('wFav');
  if (!b) return;
  const fav = (S.favorites || []).indexOf(w[0]) >= 0;
  b.textContent = fav ? '★' : '☆';
  b.style.color = fav ? '#f59e0b' : 'var(--sub)';
  b.onclick = () => { toggleFavWord(w); updateFavBtn(w); };
}
function toggleFavWord(w) {
  const i = (S.favorites || []).indexOf(w[0]);
  if (i >= 0) S.favorites.splice(i, 1); else S.favorites.push(w[0]);
  save();
  showToast(i >= 0 ? '已移出生词本' : '⭐ 已加入生词本');
}
$('wShow').onclick = () => {
  $('wDetail').style.display = 'block';
  $('wBtns').style.display = 'flex';
  $('wShow').style.display = 'none';
};
function rate(r) {
  const w = learnQueue[learnIdx];
  srsRate(w, r);
  recordLearn(w);
  autoFav(w, r); // 模糊/不认识自动进生词本，认识自动移出
  touchStreak(); save();
  learnIdx++;
  savePos();
  checkDailyTarget();
  if (learnIdx >= learnQueue.length) renderLearnDone(); else renderLearnCard();
}
// 自动生词本管理：评分<2 进生词本；评分认识(2)移出生词本
function autoFav(w, r) {
  const i = (S.favorites || []).indexOf(w[0]);
  if (r < 2) { if (i < 0) S.favorites.push(w[0]); }
  else { if (i >= 0) S.favorites.splice(i, 1); }
}
function renderLearnDone() {
  delete S.lastWord[learnLevel]; // 学完一轮，下次从头开始
  save();
  $('wCard').style.display = 'none';
  $('learnDone').style.display = 'block';
  const total = words().length;
  const seen = Object.keys(S.statuses).length;
  const master = words().filter(isMastered).length;
  const weak = weakWords().length;
  let html = '<div class="card"><div class="done-title">🎉 本轮完成！</div>';
  html += '<div class="chips" style="justify-content:center">';
  html += '<span class="chip">总词数 ' + total + '</span><span class="chip">已学 ' + seen + '</span><span class="chip">已掌握 ' + master + '</span><span class="chip">待复习 ' + dueWords().length + '</span><span class="chip">不认识 ' + weak + '</span>';
  html += '</div><div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
  html += '<button class="btn btn-primary" style="flex:1" onclick="startStudy()">继续学习</button>';
  html += '<button class="btn btn-mid" style="flex:1" onclick="startReview()">复习到期词 (' + dueWords().length + ')</button>';
  html += '</div></div>';
  $('learnDone').innerHTML = html;
}

/* ---------- 练习列表 ---------- */
function visibleReadings() { return READING.filter(r => (S.hiddenReadings || []).indexOf(r.id) < 0); }
function visibleClozees() { return CLOZE.filter(c => (S.hiddenCloze || []).indexOf(c.id) < 0).concat(S.customCloze || []); }
function openPractice() {
  const lvBadge = l => '<span class="badge" style="background:' + (l <= 2 ? '#dcfce7;color:#166534' : l === 3 ? '#fef3c7;color:#92400e' : '#fee2e2;color:#991b1b') + '">' + diffName(l) + '</span>';
  $('readingList').innerHTML = visibleReadings().map((r, i) =>
    '<div class="prac-item" onclick="openRead(' + i + ')"><div><div class="t">📖 ' + esc(r.title) + '</div><div class="meta">' + r.questions.length + ' 题 · 原创模拟</div></div>' + lvBadge(r.level) +
    '<button class="w-fav-btn" style="font-size:18px" onclick="event.stopPropagation();delPrac(\'r\',\'' + esc(r.id) + '\')" title="删除">🗑</button></div>'
  ).join('');
  $('clozeList').innerHTML = visibleClozees().map((c, i) =>
    '<div class="prac-item" onclick="openCloze(' + i + ')"><div><div class="t">🔤 ' + esc(c.title) + '</div><div class="meta">' + c.blanks.length + ' 空 · ' + (c.custom ? 'AI 生成' : '原创模拟') + '</div></div>' + lvBadge(c.level) +
    '<button class="w-fav-btn" style="font-size:18px" onclick="event.stopPropagation();delPrac(\'c\',\'' + esc(c.id) + '\')" title="删除">🗑</button></div>'
  ).join('');
}
function delPrac(kind, id) {
  const hidden = kind === 'r' ? (S.hiddenReadings = S.hiddenReadings || []) : (S.hiddenCloze = S.hiddenCloze || []);
  const builtin = kind === 'r' ? READING : CLOZE;
  const item = builtin.find(x => x.id === id);
  if (item) {
    if (!confirm('确定删除《' + item.title + '》？可在设置里恢复。')) return;
    if (hidden.indexOf(id) < 0) hidden.push(id);
    save();
    openPractice();
    showToast('🗑 已删除');
    return;
  }
  // 自定义（AI 生成）
  const arr = kind === 'r' ? (S.customReading || []) : (S.customCloze || []);
  const ci = arr.findIndex(x => x.id === id);
  if (ci < 0) return;
  if (!confirm('确定删除《' + arr[ci].title + '》？')) return;
  arr.splice(ci, 1);
  save();
  openPractice();
  showToast('🗑 已删除');
}
function restoreDefaultPrac() {
  const n = (S.hiddenReadings || []).length + (S.hiddenCloze || []).length;
  if (!n) { showToast('没有已删除的题库'); return; }
  if (confirm('确定恢复全部已删除的内置阅读/完形？')) {
    S.hiddenReadings = []; S.hiddenCloze = [];
    save();
    openPractice();
    showToast('♻️ 已恢复默认题库');
  }
}

/* ---------- 点词查义 ---------- */
function tapWords(text) {
  return String(text).split(/(\b[\w'-]+\b)/g).map(seg => {
    if (/^[\w'-]+$/.test(seg)) {
      return '<span class="tap-word" onclick="wordPop(\'' + esc(seg) + '\')">' + esc(seg) + '</span>';
    }
    return esc(seg);
  }).join('');
}
function wordPop(word) {
  const w = words().find(x => x[0].toLowerCase() === String(word).toLowerCase());
  $('wpWord').textContent = word;
  if (w) {
    $('wpIpa').textContent = w[1] || '';
    $('wpCn').textContent = (w[2] ? w[2] + ' ' : '') + (w[3] || '');
    $('wordPop').style.display = 'block';
    speak(word);
    return;
  }
  // 词库未收录：先查 AI 缓存，没有再调 AI 翻译
  const key = String(word).toLowerCase();
  const cached = (S.aiWordCache || {})[key];
  if (cached) {
    $('wpIpa').textContent = cached.ipa || '';
    $('wpCn').textContent = cached.cn || '';
    $('wordPop').style.display = 'block';
    speak(word);
    return;
  }
  $('wpIpa').textContent = '';
  if (S.aiKey) {
    $('wpCn').textContent = '🤖 AI 翻译中…';
    $('wordPop').style.display = 'block';
    speak(word);
    aiTranslateWord(word);
  } else {
    $('wpCn').textContent = '词库未收录。填写 API Key 后可用 AI 翻译';
    $('wordPop').style.display = 'block';
    speak(word);
  }
}
async function aiTranslateWord(word) {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': '***' + S.aiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: '你是英汉词典。翻译单词或短语 "' + word + '"，只输出 JSON：{"ipa":"英式音标,可空","cn":"简短中文释义,含词性如 n. 名词"}' }],
        temperature: 0.3,
        max_tokens: 200
      })
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    let txt = String(content || '').trim().replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
    const d = JSON.parse(txt);
    const cn = d.cn || '（AI 未能翻译）';
    const ipa = d.ipa || '';
    S.aiWordCache = S.aiWordCache || {};
    S.aiWordCache[String(word).toLowerCase()] = { ipa: ipa, cn: cn };
    save();
    if ($('wpWord').textContent.toLowerCase() === String(word).toLowerCase()) {
      $('wpIpa').textContent = ipa;
      $('wpCn').textContent = cn;
    }
  } catch (e) {
    if ($('wpWord').textContent.toLowerCase() === String(word).toLowerCase()) {
      $('wpCn').textContent = 'AI 翻译失败：' + (e.message || e);
    }
  }
}
function hideWordPop() { $('wordPop').style.display = 'none'; }
$('wpSpeak').onclick = () => { const w = $('wpWord').textContent; if (w) speak(w); };

/* ---------- 阅读 ---------- */
let curRead = -1, readAns = {};
function openRead(i) {
  curRead = i; readAns = {};
  const r = visibleReadings()[i];
  $('readTitle').textContent = r.title;
  $('readLevel').textContent = levelName(r.level) + ' · 阅读';
  $('readPassage').innerHTML = tapWords(r.passage);
  renderReadQs();
  showView('read');
}
function renderReadQs() {
  const r = visibleReadings()[curRead];
  const answered = Object.keys(readAns).length;
  $('readProg').textContent = answered + ' / ' + r.questions.length;
  $('readQs').innerHTML = r.questions.map((q, qi) => {
    const a = readAns[qi];
    let optsHtml = q.opts.map((o, oi) => {
      let cls = 'opt';
      let mark = '';
      if (a !== undefined) {
        if (oi === q.opts.indexOf(q.ans)) { cls += ' right'; mark = ' ✓'; }
        else if (oi === a && a !== q.opts.indexOf(q.ans)) { cls += ' wrong'; mark = ' ✗ 你的答案'; }
      }
      return '<button class="' + cls + '" ' + (a !== undefined ? 'disabled' : 'onclick="answerRead(' + qi + ',' + oi + ')"') + '>' + String.fromCharCode(65 + oi) + '. ' + esc(o) + mark + '</button>';
    }).join('');
    const whyHtml = a !== undefined ? '<div class="why" style="display:block">' + esc(q.why) + '</div>' : '';
    return '<div class="q-block"><div class="q-num">' + (qi + 1) + '. ' + esc(q.q) + '</div>' + optsHtml + whyHtml + '</div>';
  }).join('');
}
function answerRead(qi, oi) {
  const q = visibleReadings()[curRead].questions[qi];
  const okIdx = q.opts.indexOf(q.ans);
  if (oi !== okIdx) {
    S.wrong.unshift({ t: 'reading', q: q.q, opts: q.opts.slice(), ans: q.ans, your: q.opts[oi], why: q.why, ts: Date.now() });
    if (S.wrong.length > 200) S.wrong.pop();
  }
  readAns[qi] = oi;
  save();
  renderReadQs();
}

/* ---------- 完形 ---------- */
let curCloze = -1, clozeAns = {};
function openCloze(i) {
  curCloze = i; clozeAns = {};
  const c = visibleClozees()[i];
  $('clozeTitle').textContent = c.title;
  $('clozeLevel').textContent = levelName(c.level) + ' · 完形';
  renderClozePassage();
  renderClozeBlanks();
  showView('cloze');
}
function clozeSegments(passage, doneMap) {
  const parts = passage.split(/____(\d+)____/g);
  let html = '';
  for (let k = 0; k < parts.length; k++) {
    if (k % 2 === 0) html += tapWords(parts[k]);
    else {
      const n = parseInt(parts[k], 10);
      const st = doneMap[n];
      const cls = 'blank' + (st === undefined ? '' : (st === 0 ? ' wrong' : ' done'));
      html += '<span class="' + cls + '">(' + n + ')</span>';
    }
  }
  return html;
}
function renderClozePassage() {
  const c = visibleClozees()[curCloze];
  const doneMap = {};
  Object.keys(clozeAns).forEach(k => { doneMap[k] = clozeAns[k]; });
  $('clozePassage').innerHTML = clozeSegments(c.passage, doneMap);
}
function renderClozeBlanks() {
  const c = visibleClozees()[curCloze];
  const answered = Object.keys(clozeAns).length;
  $('clozeBlanks').innerHTML = c.blanks.map((b, bi) => {
    const n = bi + 1;
    const a = clozeAns[n];
    const optsHtml = b.opts.map((o, oi) => {
      let cls = 'opt';
      let mark = '';
      if (a !== undefined) {
        if (oi === b.opts.indexOf(b.ans)) { cls += ' right'; mark = ' ✓'; }
        else if (oi === a && a !== b.opts.indexOf(b.ans)) { cls += ' wrong'; mark = ' ✗'; }
      }
      return '<button class="' + cls + '" style="display:inline-block;width:auto;margin:0 6px 6px 0;padding:8px 12px;font-size:13px" ' + (a !== undefined ? 'disabled' : 'onclick="answerCloze(' + n + ',' + oi + ')"') + '>' + String.fromCharCode(65 + oi) + '. ' + esc(o) + mark + '</button>';
    }).join('');
    const whyHtml = a !== undefined ? '<div class="why" style="display:block;margin-top:6px">' + esc(b.why) + '</div>' : '';
    return '<div class="blank-row"><div class="b-head">' + n + '. ' + (a !== undefined ? (a === b.opts.indexOf(b.ans) ? '✅ ' : '❌ ') : '') + '</div>' + optsHtml + whyHtml + '</div>';
  }).join('') +
    '<div style="margin-top:12px" class="lbl">完成 ' + answered + ' / ' + c.blanks.length + '</div>';
}
function answerCloze(n, oi) {
  const c = visibleClozees()[curCloze];
  const b = c.blanks[n - 1];
  const okIdx = b.opts.indexOf(b.ans);
  if (oi !== okIdx) {
    S.wrong.unshift({ t: 'cloze', q: '完形第 ' + n + ' 空（' + c.title + '）', opts: b.opts.slice(), ans: b.ans, your: b.opts[oi], why: b.why, ts: Date.now() });
    if (S.wrong.length > 200) S.wrong.pop();
    clozeAns[n] = 0;
  } else {
    clozeAns[n] = 1;
  }
  save();
  renderClozePassage();
  renderClozeBlanks();
}

/* ---------- 测验 ---------- */
let quizQ = [], quizI = 0, quizRight = 0, quizSel = -1, quizCount = 10, quizScope = 'all';
function openQuiz() { resetQuizUI(); }
function qzCountSeg() {
  const opts = [{ n: 10, l: '10 题' }, { n: 20, l: '20 题' }, { n: 0, l: '全部' }];
  return opts.map(o => '<button class="' + (quizCount === o.n ? 'on' : '') + '" onclick="setQzCount(' + o.n + ')">' + o.l + '</button>').join('');
}
function qzScopeSeg() {
  const opts = [{ s: 'all', l: '全部' }, { s: 'weak', l: '未掌握' }].concat(CATS.slice(1).map((n, i) => ({ s: 'c' + (i + 1), l: n })));
  return opts.map(o => '<button class="' + (quizScope === o.s ? 'on' : '') + '" onclick="setQzScope(\'' + o.s + '\')">' + o.l + '</button>').join('');
}
function resetQuizUI() {
  $('qzCountSeg').innerHTML = qzCountSeg();
  $('qzScopeSeg').innerHTML = qzScopeSeg();
  $('qzSetup').style.display = 'block';
  $('qzRun').style.display = 'none';
  $('qzResult').style.display = 'none';
}
function setQzCount(n) { quizCount = n; $('qzCountSeg').innerHTML = qzCountSeg(); }
function setQzScope(s) { quizScope = s; $('qzScopeSeg').innerHTML = qzScopeSeg(); }
function makeWordItem(w) {
  const ws = words();
  const en2cn = Math.random() < 0.7;
  const q = en2cn ? w[0] : w[3];
  const correct = en2cn ? w[3] : w[0];
  const field = en2cn ? 3 : 0;
  const dist = [];
  const seenSet = new Set([correct]);
  for (const x of shuffle(ws)) {
    if (x[field] !== correct && !seenSet.has(x[field])) { dist.push(x[field]); seenSet.add(x[field]); if (dist.length >= 3) break; }
  }
  while (dist.length < 3) dist.push('———');
  const opts = shuffle([correct].concat(dist));
  const why = (en2cn ? '「' + w[0] + '」' + w[2] + ' ' + w[3] : '「' + w[3] + '」' + w[0] + ' ' + w[2]) + (w[4] ? '；例句：' + w[4] : '');
  return { t: en2cn ? 'w12' : 'w21', q, opts, ans: correct, why, word: w[0] };
}
function typeLabel(it) {
  if (it.t === 'w12') return '单词 · 英译中';
  if (it.t === 'w21') return '单词 · 中译英';
  if (it.t === 'g') return '语法单选';
  if (it.t === 'sg') return '句子填空';
  return '错题重做';
}

/* ---------- 自动出题（句子填空，无限生成） ---------- */
function makeSentenceItem(w) {
  const ex = w[4];
  const re = new RegExp('\\b' + w[0] + '\\b', 'i');
  if (!ex || !re.test(ex)) return null;
  const stem = ex.replace(re, '____');
  const dist = [];
  const seen = {};
  seen[w[0].toLowerCase()] = 1;
  const ws = words();
  const targetPos = (w[2] || '').split('/')[0];
  for (const x of shuffle(ws)) {
    const cand = x[0].toLowerCase();
    if (cand.length < 3 || /\s/.test(cand) || seen[cand]) continue;
    if (targetPos && x[2] && x[2].split('/')[0] === targetPos) { dist.push(cand); seen[cand] = 1; if (dist.length >= 3) break; }
  }
  for (const x of shuffle(ws)) {
    const cand = x[0].toLowerCase();
    if (cand.length < 3 || /\s/.test(cand) || seen[cand]) continue;
    dist.push(cand); seen[cand] = 1;
    if (dist.length >= 3) break;
  }
  while (dist.length < 3) dist.push('———');
  return { t: 'sg', q: stem, opts: shuffle([w[0]].concat(dist)), ans: w[0], why: '「' + w[0] + '」' + (w[2] ? ' ' + w[2] : '') + ' ' + w[3] + '；例句：' + ex, word: w[0] };
}
function startAutoQuiz(n) {
  const pool = shuffle(words().filter(w => w[4] && !/\s/.test(w[0]) && w[0].length >= 3));
  const items = [];
  for (const w of pool) {
    if (items.length >= n) break;
    const it = makeSentenceItem(w);
    if (it) items.push(it);
  }
  if (!items.length) { alert('没有可用的例句'); return; }
  quizQ = items; quizI = 0; quizRight = 0;
  $('qzSetup').style.display = 'none';
  $('qzResult').style.display = 'none';
  $('qzRun').style.display = 'block';
  renderQuizQ();
}
function startQuiz() {
  const ws = words();
  let pool;
  if (quizScope === 'weak') pool = ws.filter(w => !isMastered(w));
  else if (quizScope.startsWith('c')) pool = ws.filter(w => (w[6] || []).indexOf(parseInt(quizScope[1], 10)) >= 0);
  else pool = ws.slice();
  if (!pool.length) pool = ws.slice();
  const withGrammar = (quizScope === 'all' || quizScope === 'weak');
  const cnt = quizCount > 0 ? quizCount : (pool.length + (withGrammar ? Math.min(GRAMMAR.length, Math.ceil(pool.length * 0.3)) : 0));
  const takeW = Math.min(pool.length, Math.max(1, Math.round(cnt * 0.7)));
  const takeG = withGrammar ? Math.min(GRAMMAR.length, cnt - takeW) : 0;
  let items = shuffle(pool).slice(0, takeW).map(makeWordItem);
  items = items.concat(shuffle(GRAMMAR).slice(0, takeG));
  quizQ = shuffle(items);
  quizI = 0; quizRight = 0;
  if (!quizQ.length) { alert('没有可出的题'); return; }
  $('qzSetup').style.display = 'none';
  $('qzResult').style.display = 'none';
  $('qzRun').style.display = 'block';
  renderQuizQ();
}
function renderQuizQ() {
  const it = quizQ[quizI];
  quizSel = -1;
  $('qzType').textContent = typeLabel(it);
  $('qzProg').textContent = (quizI + 1) + ' / ' + quizQ.length;
  $('qzStem').textContent = it.q;
  $('qzOpts').innerHTML = it.opts.map((o, idx) =>
    '<button class="opt" onclick="answerQuiz(' + idx + ')">' + String.fromCharCode(65 + idx) + '. ' + esc(o) + '</button>'
  ).join('');
  $('qzWhy').style.display = 'none';
  $('qzNext').style.display = 'none';
}
function answerQuiz(idx) {
  if (quizSel >= 0) return;
  quizSel = idx;
  const it = quizQ[quizI];
  const btns = $('qzOpts').children;
  const okIdx = it.opts.indexOf(it.ans);
  for (let i = 0; i < btns.length; i++) btns[i].disabled = true;
  btns[idx].classList.add(idx === okIdx ? 'right' : 'wrong');
  btns[okIdx].classList.add('right');
  if (idx === okIdx) { quizRight++; S.quiz.right++; }
  else {
    S.wrong.unshift({ t: it.t, q: it.q, opts: it.opts.slice(), ans: it.ans, your: it.opts[idx], why: it.why, word: it.word, ts: Date.now() });
    if (S.wrong.length > 200) S.wrong.pop();
  }
  S.quiz.n++; touchStreak(); save();
  let whyHtml = '✅ 正确答案：<b>' + esc(it.ans) + '</b><br>';
  if (idx !== okIdx) whyHtml += '❌ 你的答案：<b style="color:var(--bad)">' + esc(it.opts[idx]) + '</b><br>';
  whyHtml += esc(it.why);
  $('qzWhy').innerHTML = whyHtml;
  $('qzWhy').style.display = 'block';
  $('qzNext').style.display = 'block';
  $('qzNext').textContent = (quizI + 1 >= quizQ.length) ? '查看结果 🏁' : '下一题 →';
}
function nextQuiz() {
  quizI++;
  if (quizI >= quizQ.length) renderQuizResult(); else renderQuizQ();
}
function renderQuizResult() {
  $('qzRun').style.display = 'none';
  const box = $('qzResult'); box.style.display = 'block';
  const rate = quizQ.length ? Math.round(quizRight / quizQ.length * 100) : 0;
  const emoji = rate >= 90 ? '🏆' : rate >= 70 ? '👍' : rate >= 50 ? '💪' : '📖';
  box.innerHTML = '<div class="done-title">' + emoji + ' 完成！</div>' +
    '<div style="text-align:center;margin:10px 0"><span style="font-size:34px;font-weight:800;color:var(--p)">' + quizRight + '</span><span style="font-size:16px;color:var(--sub)"> / ' + quizQ.length + '</span><div class="lbl" style="margin-top:4px">正确率 ' + rate + '%（做错的题已进错题本）</div></div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn btn-primary" style="flex:1" onclick="startQuiz()">再测一组</button>' +
    '<button class="btn btn-ghost" style="flex:1" onclick="showView(\'errors\')">看错题本</button>' +
    '</div>';
}

/* ---------- 生词本 ---------- */
function favWords() { return words().filter(w => (S.favorites || []).indexOf(w[0]) >= 0); }
function renderFavs() {
  const fw = favWords();
  const box = $('favList');
  if (!fw.length) {
    box.innerHTML = '<div class="empty">生词本是空的</div>' +
      '<div class="card" style="text-align:center;padding:20px">' +
      '<div style="font-size:36px;margin-bottom:8px">⭐</div>' +
      '<div class="lbl" style="line-height:1.9">学习时评「模糊」「不认识」、拼错 → 自动加入<br>评「认识」→ 自动移出<br>也可点单词卡右上角 ☆ 手动收藏<br>「📥 加入未学词」一键把没学过的词加进来</div></div>';
    return;
  }
  box.innerHTML = fw.map(w =>
    '<div class="fav-item"><div><div class="w">' + esc(w[0]) + ' <button class="icon-btn mini" data-say="' + esc(w[0]) + '" title="发音">🔊</button></div>' +
    '<div class="c">' + esc(w[2] || '') + ' ' + esc(w[3] || '') + '</div></div>' +
    '<button class="rm" onclick="unfav(\'' + esc(w[0]) + '\')">✕ 移除</button></div>'
  ).join('');
}
function startFavReview() {
  const fw = favWords();
  if (!fw.length) { alert('生词本是空的'); return; }
  learnMode = 'fav';
  learnQueue = fw.slice();
  learnIdx = 0;
  // 切到学习视图但不重置队列
  document.querySelectorAll('section.view').forEach(s => s.classList.remove('active'));
  $('view-learn').classList.add('active');
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.v === 'learn'));
  $('learnDone').style.display = 'none';
  $('wCard').style.display = 'block';
  renderLearnCard();
  showToast('⭐ 开始复习生词，共 ' + fw.length + ' 个');
}
function addUnlearnedToFav() {
  const pool = queueForLevel().filter(w => !isMastered(w));
  let added = 0;
  pool.forEach(w => {
    if ((S.favorites || []).indexOf(w[0]) < 0) { S.favorites.push(w[0]); added++; }
  });
  save();
  renderFavs();
  showToast('📥 已加入 ' + added + ' 个未学词');
}
function unfav(word) {
  const i = (S.favorites || []).indexOf(word);
  if (i >= 0) S.favorites.splice(i, 1);
  save();
  renderFavs();
}
function clearFavs() {
  const n = (S.favorites || []).length;
  if (!n) return;
  if (confirm('确定把生词本里的全部 ' + n + ' 个词移除？')) {
    S.favorites = [];
    save();
    renderFavs();
    showToast('🗑 已清空生词本');
  }
}

/* ---------- 全词库搜索 ---------- */
function onSearch(q) {
  const box = $('searchList');
  const s = String(q || '').trim().toLowerCase();
  if (!s) { box.innerHTML = '<div class="hint">输入单词或中文释义搜索，如 abandon、放弃</div>'; return; }
  const ws = words();
  const hit = [];
  for (const w of ws) {
    if (hit.length >= 30) break;
    if (w[0].toLowerCase().indexOf(s) >= 0 || String(w[3] || '').toLowerCase().indexOf(s) >= 0) hit.push(w);
  }
  if (!hit.length) { box.innerHTML = '<div class="hint">没找到，换个词试试</div>'; return; }
  box.innerHTML = hit.map(w => {
    const fav = (S.favorites || []).indexOf(w[0]) >= 0;
    return '<div class="srch-item"><div class="row"><span class="w">' + esc(w[0]) + ' <button class="icon-btn mini" data-say="' + esc(w[0]) + '" title="发音">🔊</button></span>' +
      '<button class="w-fav-btn" onclick="toggleFavWordFromSearch(\'' + esc(w[0]) + '\')" title="收藏">' + (fav ? '★' : '☆') + '</button></div>' +
      '<div class="c">' + esc(w[2] || '') + ' ' + esc(w[3] || '') + '</div>' +
      (w[4] ? '<div class="c" style="font-style:italic">' + esc(w[4]) + '</div>' : '') +
      '</div>';
  }).join('');
}
function toggleFavWordFromSearch(word) {
  const w = words().find(x => x[0] === word);
  if (!w) return;
  toggleFavWord(w);
  onSearch($('searchInput').value);
}

/* ---------- 错题本 ---------- */
function openErrors() { renderErrors(); }
function renderErrors() {
  const box = $('errList');
  if (!S.wrong.length) { box.innerHTML = '<div class="empty">🎉 没有错题，继续保持！</div>'; return; }
  let html = '';
  S.wrong.forEach(it => {
    const okIdx = it.opts.indexOf(it.ans);
    const yourIdx = it.opts.indexOf(it.your);
    const d = new Date(it.ts);
    html += '<div class="err-item">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center"><span class="badge">' + typeLabel(it) + '</span><span class="lbl">' + (d.getMonth() + 1) + '月' + d.getDate() + '日</span></div>';
    html += '<div class="t">' + esc(it.q) + '</div>';
    it.opts.forEach((o, oi) => {
      let cls = 'o'; let mark = '';
      if (oi === okIdx) { cls += ' c'; mark = ' ✓'; }
      if (oi === yourIdx && yourIdx !== okIdx) { cls += ' y'; mark = ' ✗ 你的答案'; }
      html += '<div class="' + cls + '">' + String.fromCharCode(65 + oi) + '. ' + esc(o) + mark + '</div>';
    });
    html += '<div class="why" style="display:block">' + esc(it.why) + '</div>';
    html += '</div>';
  });
  box.innerHTML = html;
}
function redoWrong() {
  const quizWrong = S.wrong.filter(it => ['w12', 'w21', 'g'].indexOf(it.t) >= 0).slice(0, 20);
  if (!quizWrong.length) { alert('可重做的错题（单词/语法题）为空'); return; }
  quizQ = shuffle(quizWrong.map(it => ({ t: it.t, q: it.q, opts: it.opts.slice(), ans: it.ans, why: it.why, word: it.word })));
  quizI = 0; quizRight = 0;
  $('qzSetup').style.display = 'none';
  $('qzResult').style.display = 'none';
  $('qzRun').style.display = 'block';
  renderQuizQ();
  showView('quiz');
}
function clearWrong() {
  if (!S.wrong.length) { alert('错题本是空的'); return; }
  if (confirm('确定清空全部错题记录？')) { S.wrong = []; save(); renderErrors(); }
}

/* ---------- 统计 ---------- */
function openStats() {
  const ws = words();
  const total = ws.length;
  const seen = Object.keys(S.statuses).length;
  const master = ws.filter(isMastered).length;
  const masterRate = seen ? Math.round(master / seen * 100) : 0;
  const quizRate = S.quiz.n ? Math.round(S.quiz.right / S.quiz.n * 100) : 0;
  const due = dueWords().length;
  const today = S.learnedToday[todayStr()] || [];
  const tiles = [
    ['🔥', S.streak.n + ' 天', '连续打卡'],
    ['🔄', due, '待复习'],
    ['📖', seen + ' / ' + total, '已学单词'],
    ['✅', master, '已掌握'],
    ['📈', masterRate + '%', '掌握率'],
    ['✏️', S.quiz.n, '答题数'],
    ['🎯', quizRate + '%', '正确率'],
    ['🗂', ws.filter(w => (w[6] || []).indexOf(8) >= 0).length, '六级词数']
  ];
  $('statGrid').innerHTML = tiles.map(x => '<div class="stat"><b>' + x[1] + '</b><span>' + x[2] + '</span></div>').join('');
  const tl = $('todayList');
  if (!today.length) { tl.innerHTML = '<div class="empty" style="padding:14px 0">今天还没学，去背一组吧 📖</div>'; }
  else {
    tl.innerHTML = today.map(w => {
      const s = S.srs[w];
      const mark = !s || s.st === 0 ? '❌' : s.st <= 2 ? '🤔' : '✅';
      const label = !s || s.st === 0 ? '不认识' : s.st <= 2 ? '学习中' : '已掌握';
      return '<div class="today-item"><span>' + mark + ' ' + esc(w) + '</span><span class="lbl">' + label + '</span></div>';
    }).join('');
  }
}

/* ---------- 深色模式 ---------- */
function applyDark() {
  if (S.dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const l = $('darkLabel');
  if (l) l.textContent = S.dark ? '开' : '关';
}
function toggleDark() {
  S.dark = !S.dark;
  save();
  applyDark();
  showToast(S.dark ? '🌙 已开启深色模式' : '☀️ 已关闭深色模式');
}

/* ---------- AI 生成阅读 ---------- */
function allReadings() { return READING.concat(S.customReading || []); }
function currentStageDefault() {
  return { 1: '小学', 2: '初中', 3: '高中', 4: '专升本', 5: '专升本', 6: '专升本', 7: '四级', 8: '六级' }[learnLevel] || '专升本';
}
function renderAiCfg() {
  const st = $('aiStage'); if (st) st.value = S.aiStage || currentStageDefault();
  const df = $('aiDiff'); if (df) df.value = S.aiDiff || '基础';
  const k = $('aiKey');
  if (k) k.value = '';
  const st2 = $('aiStatus');
  if (st2) st2.textContent = S.aiKey ? '· Key 已设置' : '· 未设置 Key';
  renderAiList();
}
function renderAiList() {
  const box = $('aiList');
  if (!box) return;
  const list = S.customReading || [];
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map((r, i) =>
    '<div class="ai-item"><div style="flex:1" onclick="openAiRead(' + i + ')"><div class="t">📖 ' + esc(r.title) + '</div><div class="m">' + r.questions.length + ' 题 · AI 生成</div></div><button class="w-fav-btn" onclick="delAiReading(' + i + ')" title="删除">🗑</button></div>'
  ).join('');
}
function delAiReading(i) {
  const item = (S.customReading || [])[i];
  if (!item) return;
  if (confirm('确定删除《' + item.title + '》？')) {
    S.customReading.splice(i, 1);
    save();
    renderAiCfg();
    showToast('🗑 已删除');
  }
}
function saveAiCfg() {
  const k = $('aiKey');
  if (k && k.value.trim()) S.aiKey = k.value.trim();
  const st = $('aiStage'); if (st) S.aiStage = st.value;
  const df = $('aiDiff'); if (df) S.aiDiff = df.value;
  save();
  renderAiCfg();
  showToast(S.aiKey ? '✅ AI 配置已保存' : 'ℹ️ 未输入新 Key，保持原 Key 不变');
}
function removeAiKey() {
  if (!S.aiKey) { showToast('当前没有保存 Key'); return; }
  if (confirm('确定移除已保存的 API Key？移除后 AI 生成需重新填写 Key。')) {
    S.aiKey = '';
    save();
    renderAiCfg();
    showToast('🗑 API Key 已移除');
  }
}
async function generateAiReading() {
  const st = $('aiStage'); if (st) S.aiStage = st.value;
  const df = $('aiDiff'); if (df) S.aiDiff = df.value;
  save();
  if (!S.aiKey) { showToast('⚠️ 请先在设置页填写 API Key'); return; }
  const status = $('aiStatus');
  if (status) status.textContent = '· 🤖 生成中（10-30 秒）';
  const stageName = S.aiStage || currentStageDefault();
  const STAGE_INFO = {
    '小学': '词汇量约 500，以短句和简单句为主，主题贴近日常生活',
    '初中': '词汇量约 1500，句式简单清晰',
    '高中': '词汇量约 3500，包含一定复杂句',
    '专升本': '词汇量约 3500-4000，难度接近大学英语四级，贴合专插本真题风格',
    '四级': '词汇量约 4500，标准大学英语四级难度',
    '六级': '词汇量约 5500，含长难句与学术词汇'
  };
  const DIFF_INFO = {
    '基础': '整体简单：短句为主、生词少、题目直白、干扰项弱',
    '中级': '常规难度：句子长短适中，题目带正常干扰项',
    '高级': '整体偏难：句子较长、生词偏多、题目陷阱多、干扰性强'
  };
  const prompt = '请生成一篇' + stageName + '英语阅读理解（按真题题型），要求：\n' +
    '1. 主题自选（校园/科技/健康/文化/环境/教育等），文章 180-220 词。词汇与句式水平：' + (STAGE_INFO[stageName] || STAGE_INFO['专升本']) + '；难度：' + (DIFF_INFO[S.aiDiff] || DIFF_INFO['基础']) + '\n' +
    '2. 出 5 道选择题：1 主旨题、1 细节题、1 推断题、1 词义题、1 标题题\n' +
    '3. 每道题 4 个选项，答案必须与正确选项的文字完全一致\n' +
    '4. 每题附中文解析（含原文依据）\n' +
    '5. 只输出 JSON，不要 Markdown 代码块围栏，格式如下：\n' +
    '{"title":"文章标题","passage":"文章正文","questions":[{"q":"题目","opts":["A选项","B选项","C选项","D选项"],"ans":"正确选项原文","why":"解析"}]}';
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.aiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 8000
      })
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      throw new Error('API ' + res.status + ': ' + errText);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    const item = parseAiReading(content);
    item.id = 'ai-' + Date.now();
    item.custom = true;
    S.customReading = S.customReading || [];
    S.customReading.push(item);
    save();
    renderAiCfg();
    showToast('🤖 已生成《' + item.title + '》');
  } catch (e) {
    if (status) status.textContent = '· 生成失败';
    showToast('❌ 生成失败：' + (e.message || e));
  }
}
// AI 生成完形填空
function parseAiCloze(content) {
  let text = String(content || '').trim();
  text = text.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
  const d = JSON.parse(text);
  if (!d.title || !d.passage || !Array.isArray(d.blanks) || d.blanks.length < 5) throw new Error('返回内容不完整');
  const blanks = d.blanks.slice(0, 10).map(b => {
    if (!b.ans || !Array.isArray(b.opts) || b.opts.length !== 4 || !b.opts.includes(b.ans) || !b.why) throw new Error('题目格式不对');
    return { ans: b.ans, opts: b.opts, why: b.why };
  });
  return { id: 'ai-cloze-' + Date.now(), title: d.title, passage: d.passage, blanks, level: 3, custom: true };
}
async function generateAiCloze() {
  const st = $('aiStage'); if (st) S.aiStage = st.value;
  const df = $('aiDiff'); if (df) S.aiDiff = df.value;
  save();
  if (!S.aiKey) { showToast('⚠️ 请先在设置页填写 API Key'); return; }
  const status = $('aiStatus');
  if (status) status.textContent = '· 🤖 生成完形中…';
  const btn = $('aiClozeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中…'; }
  const stageName = S.aiStage || currentStageDefault();
  const STAGE_INFO = {
    '小学': '词汇量约 500，以短句和简单句为主，主题贴近日常生活',
    '初中': '词汇量约 1500，句式简单清晰',
    '高中': '词汇量约 3500，包含一定复杂句',
    '专升本': '词汇量约 3500-4000，难度接近大学英语四级，贴合专插本真题风格',
    '四级': '词汇量约 4500，标准大学英语四级难度',
    '六级': '词汇量约 5500，含长难句与学术词汇'
  };
  const DIFF_INFO = {
    '基础': '整体简单：短句为主、生词少、题目直白、干扰项弱',
    '中级': '常规难度：句子长短适中，题目带正常干扰项',
    '高级': '整体偏难：句子较长、生词偏多、题目陷阱多、干扰性强'
  };
  const prompt = '请生成一篇' + stageName + '英语完形填空（按真题题型），要求：\n' +
    '1. 主题自选（校园/科技/健康/文化/环境/教育等），文章 150-200 词。词汇与句式水平：' + (STAGE_INFO[stageName] || STAGE_INFO['专升本']) + '；难度：' + (DIFF_INFO[S.aiDiff] || DIFF_INFO['基础']) + '\n' +
    '2. 挖 10 个空，空处用 ____1____、____2____ 这样标记，数字从 1 开始连续递增\n' +
    '3. 每空 4 个选项，答案必须与正确选项的文字完全一致\n' +
    '4. 每题附中文解析（含原文依据）\n' +
    '5. 只输出 JSON，不要 Markdown 代码块围栏，格式如下：\n' +
    '{"title":"文章标题","passage":"含 ____1____ 占位的文章正文","blanks":[{"ans":"正确选项原文","opts":["A选项","B选项","C选项","D选项"],"why":"解析"}]}';
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.aiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 8000
      })
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      throw new Error('API ' + res.status + ': ' + errText);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    const item = parseAiCloze(content);
    S.customCloze = S.customCloze || [];
    S.customCloze.push(item);
    save();
    renderAiCfg();
    showToast('🔤 已生成《' + item.title + '》，去练习页查看');
  } catch (e) {
    if (status) status.textContent = '· 生成失败';
    showToast('❌ 生成失败：' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔤 生成完形'; }
  }
}
function parseAiReading(content) {
  let text = String(content || '').trim();
  text = text.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
  const d = JSON.parse(text);
  if (!d.title || !d.passage || !Array.isArray(d.questions) || d.questions.length < 3) throw new Error('返回内容不完整');
  const questions = d.questions.slice(0, 5).map(q => {
    if (!q.q || !Array.isArray(q.opts) || q.opts.length !== 4 || !q.opts.includes(q.ans) || !q.why) throw new Error('题目格式不对');
    return { q: q.q, opts: q.opts, ans: q.ans, why: q.why };
  });
  return { title: d.title, passage: d.passage, questions, level: 3 };
}
function openAiRead(i) {
  const r = (S.customReading || [])[i];
  if (!r) return;
  currentAiReading = r;
  readAns = {};
  $('readTitle').textContent = r.title;
  $('readLevel').textContent = 'AI 生成 · 阅读';
  $('readPassage').innerHTML = tapWords(r.passage);
  renderAiQs(r);
  showView('read');
}
function renderAiQs(r) {
  const answered = Object.keys(readAns).length;
  $('readProg').textContent = answered + ' / ' + r.questions.length;
  $('readQs').innerHTML = r.questions.map((q, qi) => {
    const a = readAns[qi];
    let optsHtml = q.opts.map((o, oi) => {
      let cls = 'opt';
      let mark = '';
      if (a !== undefined) {
        if (oi === q.opts.indexOf(q.ans)) { cls += ' right'; mark = ' ✓'; }
        else if (oi === a && a !== q.opts.indexOf(q.ans)) { cls += ' wrong'; mark = ' ✗ 你的答案'; }
      }
      return '<button class="' + cls + '" ' + (a !== undefined ? 'disabled' : 'onclick="answerAiRead(' + qi + ',' + oi + ')"') + '>' + String.fromCharCode(65 + oi) + '. ' + esc(o) + mark + '</button>';
    }).join('');
    const whyHtml = a !== undefined ? '<div class="why" style="display:block">' + esc(q.why) + '</div>' : '';
    return '<div class="q-block"><div class="q-num">' + (qi + 1) + '. ' + esc(q.q) + '</div>' + optsHtml + whyHtml + '</div>';
  }).join('');
}
let currentAiReading = null;
function answerAiRead(qi, oi) {
  const q = currentAiReading && currentAiReading.questions[qi];
  if (!q) return;
  const okIdx = q.opts.indexOf(q.ans);
  if (oi !== okIdx) {
    S.wrong.unshift({ t: 'reading', q: q.q, opts: q.opts.slice(), ans: q.ans, your: q.opts[oi], why: q.why, ts: Date.now() });
    if (S.wrong.length > 200) S.wrong.pop();
  }
  readAns[qi] = oi;
  save();
  renderAiQs(currentAiReading);
}


/* ---------- 设置 ---------- */
function exportData() {
  const data = { v: 2, words: words(), state: S };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'YH英语通-进度备份-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const mergeWords = (d.words || []).filter(x => x && x.length >= 2).map(x => [x[0], x[1] || '', x[2] || '', x[3] || '', x[4] || '', x[5] || '', x[6] || 2]);
      const st = d.state || {};
      mergeWords.forEach(w => {
        if (WORDS.some(x => x[0] === w[0])) return;
        if (!S.extraWords.some(x => x[0] === w[0])) S.extraWords.push(w);
      });
      S.statuses = Object.assign(S.statuses, st.statuses || {});
      S.srs = Object.assign(S.srs, st.srs || {});
      S.quiz.n += (st.quiz && st.quiz.n) || 0;
      S.quiz.right += (st.quiz && st.quiz.right) || 0;
      if (st.wrong && st.wrong.length) S.wrong = S.wrong.concat(st.wrong).slice(0, 200);
      if (st.streak && st.streak.n > S.streak.n) S.streak = st.streak;
      save(); alert('导入成功！'); openStats();
    } catch (err) { alert('导入失败：文件格式不对'); }
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
});
$('importCsv').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const parsed = parseCSV(String(r.result));
    if (!parsed.length) { alert('没有解析到有效单词'); return; }
    const before = S.extraWords.length;
    parsed.forEach(w => {
      if (WORDS.some(x => x[0] === w[0])) return;
      if (!S.extraWords.some(x => x[0] === w[0])) S.extraWords.push(w);
    });
    save();
    alert('导入 ' + parsed.length + ' 个词，新增 ' + (S.extraWords.length - before) + ' 个（内置词表已有的自动跳过）');
    openLearn();
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
});
function parseCSV(text) {
  const LNAMES = { '基础': 1, '初级': 2, '中级': 3, '高级': 4 };
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines) {
    if (ln.startsWith('#')) continue;
    let p;
    if (ln.includes('\t')) p = ln.split('\t');
    else if (ln.includes(',')) p = ln.split(',');
    else if (ln.includes('，')) p = ln.split('，');
    else p = [ln];
    p = p.map(x => x.trim());
    if (!p[0]) continue;
    let lv = 2;
    if (p[6]) {
      const n = parseInt(p[6], 10);
      lv = (n >= 1 && n <= 4) ? n : (LNAMES[p[6]] || 2);
    }
    out.push([p[0], p[1] || '', p[2] || '', p[3] || '', p[4] || '', p[5] || '', lv]);
  }
  return out;
}
function resetAll() {
  if (confirm('确定重置全部进度？单词掌握状态、错题、统计都会被清空，且无法恢复！')) {
    localStorage.removeItem(LS);
    location.reload();
  }
}

/* ---------- 发音 ---------- */
function speak(text) {
  const t = String(text || '').trim();
  if (!t) return;
  try {
    // 有道发音接口（读音准），失败回退系统 TTS
    const url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(t) + '&type=2';
    if (!window.__audio) window.__audio = new Audio();
    window.__audio.src = url;
    window.__audio.play().catch(() => speakTTS(t));
  } catch (e) { speakTTS(t); }
}
function speakTTS(t) {
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'en-US'; u.rate = .9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
document.addEventListener('click', e => {
  const t = e.target.closest ? e.target.closest('[data-say]') : null;
  if (t) speak(t.dataset.say);
  // 点击分类下拉外部时收起
  const picker = e.target.closest ? e.target.closest('.cat-picker') : null;
  if (!picker) {
    const m = $('catMenu');
    if (m) m.classList.remove('open');
  }
});

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}

/* ---------- 启动 ---------- */
applyDark();
renderAiCfg();
openLearn();
