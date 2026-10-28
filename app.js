// ───────────── helpers ─────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => String(s).trim().split("\n").map((x) => x.trimEnd()).join("\n");
const DAY = 86400000;
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA"); // YYYY-MM-DD local
const REVIEW_GAPS = [1, 3, 7, 14, 30]; // days until a lesson is due again, per mastery level
const LEVEL_XP = 150;
const XP = { quiz: 5, task: 50, read: 30, review: 20, exam: 5, examPass: 25 };
const SESSION_ICON = { 1: "✏️", 2: "🔁", 3: "📦", 4: "🧰", 5: "λ" };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
}

// ───────────── storage ─────────────
const KEY = "pydaily.v1";
const blank = () => ({ lessons: {}, streak: 0, best: 0, lastDay: null, examBest: 0, days: {}, xp: 0 });
const store = {
  get() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY)) || {};
      const d = Object.assign(blank(), raw);
      // older saves have no XP yet: credit finished lessons once
      if (raw.lessons && !("xp" in raw)) d.xp = Object.values(d.lessons).filter((s) => s.done).length * XP.task;
      return d;
    } catch { return blank(); }
  },
  set(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} },
};

const levelOf = (xp) => ({ level: Math.floor(xp / LEVEL_XP) + 1, into: xp % LEVEL_XP });
const doneCount = (d) => Object.values(d.lessons).filter((s) => s.done).length;
const isDone = (d, id) => !!d.lessons[id]?.done;

function bumpStreak(d) {
  const today = dayKey();
  d.days[today] = (d.days[today] || 0) + 1;
  if (d.lastDay === today) return;
  d.streak = d.lastDay === dayKey(Date.now() - DAY) ? d.streak + 1 : 1;
  d.best = Math.max(d.best, d.streak);
  d.lastDay = today;
}

// adds XP and says whether that crossed into a new level
function addXP(d, n) {
  const before = levelOf(d.xp).level;
  d.xp += n;
  return levelOf(d.xp).level > before;
}

function gainXP(n) {
  const d = store.get();
  const up = addXP(d, n);
  store.set(d);
  renderStats();
  if (up) toast(`⭐ Level up! You're now level ${levelOf(d.xp).level}`);
}

// correct=true moves a lesson up a mastery level; false sends it back to level 0
function recordLesson(id, correct, xp = 0) {
  const d = store.get();
  const prev = d.lessons[id];
  const level = correct ? (prev ? Math.min(prev.level + 1, REVIEW_GAPS.length - 1) : 0) : 0;
  d.lessons[id] = { level, seen: Date.now(), done: correct || (prev && prev.done) || false };
  if (correct) bumpStreak(d);
  const leveledUp = addXP(d, xp);
  store.set(d);
  renderStats();
  renderSidebar();
  return { firstTime: correct && !prev?.done, leveledUp, d };
}

function dueLessons() {
  const d = store.get();
  return Object.entries(d.lessons)
    .filter(([id, s]) => s.done && LESSONS.some((l) => l.id === id))
    .filter(([, s]) => Date.now() - s.seen >= REVIEW_GAPS[s.level] * DAY)
    .sort((a, b) => a[1].seen - b[1].seen)
    .map(([id]) => id);
}

// ───────────── python syntax highlighting ─────────────
const KW = new Set("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "));
const CONST = new Set(["True", "False", "None", "self"]);
const BUILTIN = new Set("print len range int float str bool list dict set tuple type input sum min max abs round sorted enumerate zip map filter open isinstance any all reversed iter next divmod pow chr ord hex bin repr format".split(" "));
const TOKEN = /(#[^\n]*)|((?:[rRfFbBuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)/g;

function highlight(src) {
  let html = "", last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    if (m[0] === "") { TOKEN.lastIndex++; continue; }
    html += esc(src.slice(last, m.index));
    const t = esc(m[0]);
    let cls = null;
    if (m[1]) cls = "com";
    else if (m[2]) cls = "str";
    else if (m[3]) cls = "num";
    else if (KW.has(m[0])) cls = "kw";
    else if (CONST.has(m[0])) cls = "const";
    else if (BUILTIN.has(m[0])) cls = "bi";
    else if (src[TOKEN.lastIndex] === "(") cls = "fn";
    html += cls ? `<span class="tk-${cls}">${t}</span>` : t;
    last = TOKEN.lastIndex;
  }
  return html + esc(src.slice(last));
}
const codeBlock = (src) => `<pre>${highlight(src)}</pre>`;

// ───────────── python runner (web worker with timeout) ─────────────
let worker, workerReady, pending = {}, nextId = 1;
function startWorker() {
  worker = new Worker("worker.js");
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") resolve();
      else if (m.type === "loadError") reject(new Error(m.error));
      else if (m.type === "result" && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    };
  });
  workerReady.then(() => { pyLoaded = true; setPyStatus(true); }, () => setPyStatus(false, true));
}
function setPyStatus(ok, failed) {
  $$("[data-py]").forEach((b) => (b.disabled = !ok));
  const s = $("#pyStatus");
  if (s) s.textContent = failed ? "⚠ Python failed to load. Check your connection and refresh." : ok ? "" : "⏳ Loading Python (first visit takes ~10 s)…";
}
function runPython(code, timeoutMs = 5000) {
  return workerReady.then(() => new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      delete pending[id];
      worker.terminate();
      pyLoaded = false;
      startWorker(); // fresh Python for the next run
      setPyStatus(false);
      resolve({ out: "", error: `Stopped after ${timeoutMs / 1000} seconds. Do you have an infinite loop?` });
    }, timeoutMs);
    pending[id] = (m) => { clearTimeout(timer); resolve(m); };
    worker.postMessage({ id, code });
  }));
}
let pyLoaded = false;

// ───────────── layout pieces ─────────────
function renderStats() {
  const d = store.get();
  const due = dueLessons().length;
  const { level, into } = levelOf(d.xp);
  const today = (d.days[dayKey()] || 0) > 0;
  $("#stats").innerHTML = `
    <span class="chip ${today ? "hot" : d.streak ? "" : "cold"}" title="${today ? "Streak kept today" : "Finish something today to keep your streak"}">
      <span class="flame">🔥</span>${d.streak}</span>
    <span class="chip hide-sm" title="${d.xp} XP · ${LEVEL_XP - into} XP to level ${level + 1}">
      <span class="lvl">Lv ${level}</span><span class="xpbar"><i style="width:${(into / LEVEL_XP) * 100}%"></i></span></span>
    ${due ? `<a class="chip due" href="#review" title="Lessons due for review">🔁 ${due}</a>` : ""}`;
}

function renderSidebar() {
  const d = store.get();
  const route = location.hash.slice(1);
  let html = `<div class="tools">
      <a href="#"><span>🗺️</span>Path</a>
      <a href="#review"><span>🔁</span>Review</a>
      <a href="#exam"><span>📝</span>Exam</a>
    </div>`;
  for (const s of Object.keys(SESSIONS).map(Number)) {
    const ls = LESSONS.filter((l) => l.session === s);
    const n = ls.filter((l) => isDone(d, l.id)).length;
    html += `<div class="sess"><h4>${SESSION_ICON[s]} S${s} · ${esc(SESSIONS[s])}</h4><span>${n}/${ls.length}</span></div>`;
    html += ls.map((l) => {
      const done = isDone(d, l.id);
      return `<a class="item ${done ? "done" : ""} ${route === l.id ? "active" : ""}" href="#${l.id}">
        <span class="tick">${done ? "✓" : ""}</span>${esc(l.title)}</a>`;
    }).join("");
  }
  $("#sidebar").innerHTML = html;
}

function setView(html, narrow) {
  const main = $("#main");
  main.className = narrow ? "narrow" : "";
  main.innerHTML = `<div class="view">${html}</div>`;
}

// ───────────── celebration ─────────────
function confetti() {
  if (reducedMotion) return;
  const c = $("#confetti"), ctx = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = ["#ffd43b", "#3776ab", "#22a565", "#ff6b6f", "#b9a6ff", "#ff9f43"];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += .38; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (now - start < 2600) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(start);
}

function celebrate(l, xp, leveledUp) {
  confetti();
  const d = store.get();
  const next = LESSONS.find((x) => !isDone(d, x.id));
  const m = $("#modal");
  m.innerHTML = `<div class="modal-box" role="dialog" aria-label="Lesson complete">
      <div class="big-emoji">${leveledUp ? "⭐" : "🎉"}</div>
      <h2>${leveledUp ? `Level ${levelOf(d.xp).level}!` : "Lesson complete!"}</h2>
      <p class="muted">${esc(l.title)} is in your toolkit now. It comes back for review tomorrow.</p>
      <div class="gain"><span class="chip">+${xp} XP</span><span class="chip hot"><span class="flame">🔥</span>${d.streak} day streak</span>
        <span class="chip">✅ ${doneCount(d)}/${LESSONS.length}</span></div>
      <div class="row">
        <button class="btn" id="mStay">Stay here</button>
        ${next ? `<a class="btn primary" href="#${next.id}" id="mNext">Next: ${esc(next.title)} →</a>` : `<a class="btn primary" href="#exam" id="mNext">Take the exam →</a>`}
      </div></div>`;
  m.hidden = false;
  $("#mNext").focus();
  $("#mStay").onclick = closeOverlays;
  $("#mNext").onclick = closeOverlays;
}

function closeOverlays() {
  $("#modal").hidden = true;
  $("#palette").hidden = true;
  document.body.classList.remove("nav-open");
}

// ───────────── home: the learning path ─────────────
function nextLesson() {
  const d = store.get();
  return LESSONS.find((l) => !isDone(d, l.id));
}

function weekStrip(d) {
  const letters = ["S", "M", "T", "W", "T", "F", "S"];
  return Array.from({ length: 7 }, (_, k) => {
    const t = Date.now() - (6 - k) * DAY, key = dayKey(t);
    const on = (d.days[key] || 0) > 0;
    return `<div class="${on ? "on" : ""} ${k === 6 ? "today" : ""}"><i>${on ? "🔥" : ""}</i>${letters[new Date(t).getDay()]}</div>`;
  }).join("");
}

function heatmap(d) {
  const weeks = 16;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const start = new Date(today.getTime() - ((weeks - 1) * 7 + today.getDay()) * DAY);
  let cells = "";
  for (let k = 0; k < weeks * 7; k++) {
    const t = start.getTime() + k * DAY;
    if (t > today.getTime()) { cells += `<i style="visibility:hidden"></i>`; continue; }
    const n = d.days[dayKey(t)] || 0;
    cells += `<i class="${n >= 4 ? "l3" : n >= 2 ? "l2" : n ? "l1" : ""}" title="${dayKey(t)}: ${n} completed"></i>`;
  }
  return cells;
}

function ring(pct, size = 64, stroke = 8, color = "var(--purple)", label = "") {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${label ? `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="${size / 4.2}" fill="var(--ink)">${label}</text>` : ""}
  </svg>`;
}

function viewHome() {
  const d = store.get();
  const done = doneCount(d);
  const next = nextLesson();
  const due = dueLessons();
  const doneToday = (d.days[dayKey()] || 0) > 0;
  const { level, into } = levelOf(d.xp);
  const tipLesson = LESSONS[Math.floor(Date.now() / DAY) % LESSONS.length];

  const chapters = Object.keys(SESSIONS).map(Number).map((s) => {
    const ls = LESSONS.filter((l) => l.session === s);
    const n = ls.filter((l) => isDone(d, l.id)).length;
    const stops = ls.map((l, i) => {
      const x = Math.sin(i * 1.15 + s);
      const state = isDone(d, l.id) ? "done" : next && l.id === next.id ? "current" : "";
      return `<div class="stop ${state} ${x > 0.15 ? "left" : ""}" style="--x:${x.toFixed(2)}">
        <a href="#${l.id}" aria-label="${esc(l.title)}${state === "done" ? " (done)" : ""}">
          <span class="node">${state === "done" ? "✓" : state === "current" ? "★" : LESSONS.indexOf(l) + 1}
            ${state === "current" ? `<span class="start-tag">${done ? "CONTINUE" : "START"}</span>` : ""}</span>
          <span class="label">${esc(l.title)}<small>${l.task ? "lesson + code task" : "lesson + quiz"}</small></span>
        </a></div>`;
    }).join("");
    return `<section class="chapter c${s}">
      <div class="chapter-head">
        <span class="badge">${SESSION_ICON[s]}</span>
        <div><div class="eyebrow">Session ${s}</div><h2>${esc(SESSIONS[s])}</h2></div>
        <div class="meta"><b>${n}/${ls.length}</b> done<div class="mini-bar"><i style="width:${(n / ls.length) * 100}%"></i></div>
          <a href="#exam-${s}">Session exam →</a></div>
      </div>
      <div class="trail"><svg aria-hidden="true"></svg>${stops}</div>
    </section>`;
  }).join("");

  setView(`
    <section class="hero">
      <div class="eyebrow">Python revision · 10 minutes a day</div>
      <h1>${done ? (doneToday ? "Streak kept. Nice work." : "Welcome back. Keep the flame lit.") : "Learn it once. Keep it forever."}</h1>
      <p>Each lesson: the meaning in plain words, the syntax, code you can run, the exam trap, a coding task and a quiz. Finished lessons come back right before you'd forget them.</p>
      <div class="row">
        ${next ? `<a class="btn primary big" href="#${next.id}">${done ? "Continue" : "Start"}: ${esc(next.title)} →</a>` : `<a class="btn primary big" href="#exam">All done! Take the exam →</a>`}
        ${due.length ? `<a class="btn big" href="#review">🔁 Review ${due.length}</a>` : `<a class="btn big" href="#exam">📝 Exam mode</a>`}
      </div>
      <div class="term" aria-hidden="true">
        <div class="dots"><i></i><i></i><i></i></div>
        <div><span class="tk-kw">&gt;&gt;&gt;</span> streak = <span class="tk-num">${d.streak}</span></div>
        <div><span class="tk-kw">&gt;&gt;&gt;</span> <span class="tk-bi">print</span>(<span class="tk-str">f"Day {streak} 🔥"</span>)</div>
        <div>Day ${d.streak} 🔥</div>
        <div><span class="tk-kw">&gt;&gt;&gt;</span> <span class="cursor"></span></div>
      </div>
    </section>
    <div class="home">
      <div class="path">${chapters}</div>
      <aside class="aside">
        <div class="card">
          <h3>🔥 ${d.streak} day streak <span class="muted small" style="margin-left:auto">best ${d.best}</span></h3>
          <p class="small muted">${doneToday ? "Today's goal done ✅ See you tomorrow." : "Finish one lesson, review or exam today to keep it."}</p>
          <div class="week">${weekStrip(d)}</div>
        </div>
        <div class="card">
          <div class="level-ring">${ring(into / LEVEL_XP, 70, 9, "var(--purple)", "Lv " + level)}
            <div><b>${d.xp} XP</b><span class="muted small">${LEVEL_XP - into} XP to level ${level + 1}</span></div></div>
          <div class="stat-grid" style="margin-top:14px">
            <div class="stat"><b>${done}<span class="muted small">/${LESSONS.length}</span></b><span>lessons done</span></div>
            <div class="stat"><b>${d.examBest}<span class="muted small">/10</span></b><span>best exam</span></div>
          </div>
          <h3 style="margin-top:16px;font-size:.9rem">Activity · last 16 weeks</h3>
          <div class="heat">${heatmap(d)}</div>
        </div>
        <div class="card tip">
          <h3>⚠️ Trap of the day</h3>
          <p>${esc(tipLesson.gotcha)}</p>
          <div class="row"><a class="small" href="#${tipLesson.id}">From “${esc(tipLesson.title)}” →</a></div>
        </div>
      </aside>
    </div>`);
  drawTrails();
}

// connect the path stops with a curvy dotted line, solid green where finished
function drawTrails() {
  $$(".trail").forEach((trail) => {
    const box = trail.getBoundingClientRect();
    const stops = $$(".stop", trail);
    const pts = stops.map((s) => {
      const r = $(".node", s).getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, done: s.classList.contains("done") };
    });
    let all = "", done = "";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
      const seg = `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y} `;
      all += seg;
      if (a.done) done += seg;
    }
    $("svg", trail).innerHTML = `<path class="t-bg" d="${all}"/><path class="t-done" d="${done}"/>`;
  });
}

// ───────────── quiz ─────────────
function quizHTML(quiz, prefix, keys = "ABCD") {
  return quiz.map((q, i) => `
    <div class="q" data-q="${prefix}${i}">
      ${/[?.]$/.test(q.q.trim()) ? `<p class="qtext">${esc(q.q)}</p>` : `<p class="qtext">What does this print?</p>${codeBlock(q.q)}`}
      <div class="opts">${q.options.map((o, j) => `<button class="opt" data-o="${j}"><span class="key">${keys[j]}</span><span>${esc(o)}</span></button>`).join("")}</div>
      <div class="why" aria-live="polite"></div>
    </div>`).join("");
}

function wireQuiz(root, quiz, prefix, onAnswer) {
  quiz.forEach((q, i) => {
    const box = root.querySelector(`[data-q="${prefix}${i}"]`);
    $$(".opt", box).forEach((b) => (b.onclick = () => {
      const ok = +b.dataset.o === q.answer;
      $$(".opt", box).forEach((x) => (x.disabled = true));
      b.classList.add(ok ? "right" : "wrong");
      if (!ok) box.querySelector(`[data-o="${q.answer}"]`).classList.add("right");
      const why = $(".why", box);
      why.className = "why " + (ok ? "ok" : "no");
      why.textContent = (ok ? "✅ Correct. " : "❌ Not quite. ") + q.why;
      onAnswer && onAnswer(ok);
    }));
  });
}

// ───────────── code editor ─────────────
function mountEditor(ta, onChange) {
  const hl = $(".hl", ta.parentElement), gutter = $(".gutter", ta.closest(".editor"));
  const sync = () => {
    hl.innerHTML = highlight(ta.value) + "\n";
    gutter.textContent = ta.value.split("\n").map((_, i) => i + 1).join("\n");
    ta.style.height = "auto"; ta.style.width = "100%";
    ta.style.height = ta.scrollHeight + "px";
    if (ta.scrollWidth > ta.clientWidth) ta.style.width = ta.scrollWidth + "px";
    hl.style.width = ta.offsetWidth + "px"; hl.style.height = ta.offsetHeight + "px";
  };
  ta.addEventListener("input", () => { sync(); onChange && onChange(); });
  ta.addEventListener("keydown", (e) => {
    const { selectionStart: s, selectionEnd: end, value: v } = ta;
    if (e.key === "Tab") {
      e.preventDefault();
      ta.setRangeText("    ", s, end, "end");
      ta.dispatchEvent(new Event("input"));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      // keep the indent of the current line, and add one level after a colon
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(lineStart, s);
      const indent = line.match(/^\s*/)[0] + (/:\s*$/.test(line) ? "    " : "");
      e.preventDefault();
      ta.setRangeText("\n" + indent, s, end, "end");
      ta.dispatchEvent(new Event("input"));
    } else if (e.key === "Backspace" && s === end && s > 0) {
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const before = v.slice(lineStart, s);
      if (before.length && /^ +$/.test(before) && before.length % 4 === 0) {
        e.preventDefault();
        ta.setRangeText("", s - 4, s, "end");
        ta.dispatchEvent(new Event("input"));
      }
    }
  });
  sync();
  return sync;
}

function consoleHTML(id, label) {
  return `<div class="console" id="${id}">
    <div class="bar-top"><span>▸ ${label}</span><span class="status"></span></div>
    <pre class="out"><span class="muted">Output appears here…</span></pre></div>`;
}

function showOutput(box, r, verdict, state) {
  box.className = "console" + (state ? " " + state : "");
  $(".status", box).textContent = state === "ok" ? "PASSED" : state === "bad" ? "NOT YET" : r ? "DONE" : "RUNNING";
  const pre = $("pre", box);
  if (!r) { pre.innerHTML = `<span class="muted">Running…</span>`; return; }
  let html = esc(r.out || "");
  if (r.error) html += (html ? "\n" : "") + `<span class="err">⚠ ${esc(r.error)}</span>`;
  if (!html) html = `<span class="muted">(no output)</span>`;
  if (verdict) html += `\n\n<span class="verdict">${esc(verdict)}</span>`;
  pre.innerHTML = html;
}

// ───────────── lesson ─────────────
let observer = null;

function viewLesson(l, opts = {}) {
  const d = store.get();
  const idx = LESSONS.indexOf(l);
  const prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
  const st = d.lessons[l.id];
  const steps = [["meaning", "📖 Meaning"], ["syntax", "🧩 Syntax"], ["example", "💡 Example"], ["trap", "⚠️ Trap"]]
    .concat(l.task ? [["task", "🎯 Your turn"]] : [], [["quiz", "🧠 Quiz"]]);

  setView(`
    ${opts.review != null ? `<div class="card review-banner"><b>🔁 Review mode</b> · ${opts.review ? `${opts.review} more after this one.` : "last one for today."} Ace the quiz to push this lesson further out.</div>` : ""}
    <div class="crumbs">
      <a href="#">← Path</a>
      <span class="tag c${l.session}" style="background:var(--c)">${SESSION_ICON[l.session]} Session ${l.session} · ${esc(SESSIONS[l.session])}</span>
      <span class="muted mono small">${idx + 1}/${LESSONS.length}</span>
    </div>
    <h1 class="lesson-title">${esc(l.title)}</h1>
    <div class="mastery" title="Mastery grows each time you get a review right">
      ${st?.done ? `Mastery ${REVIEW_GAPS.map((_, k) => `<i class="${k <= st.level ? "on" : ""}"></i>`).join("")} · next review in ${REVIEW_GAPS[st.level]} day${REVIEW_GAPS[st.level] > 1 ? "s" : ""}` : `<span>⏱ about 5 minutes · ${l.task ? "+" + XP.task : "+" + XP.read} XP</span>`}
    </div>
    <nav class="stepper" aria-label="Lesson sections">${steps.map(([id, t]) => `<button data-to="s-${id}">${t}</button>`).join("")}</nav>

    <div class="card section meaning" id="s-meaning"><h3><span class="num">01</span> Meaning</h3><p>${esc(l.meaning)}</p></div>
    <div class="card section" id="s-syntax"><h3><span class="num">02</span> Syntax</h3>${codeBlock(l.syntax)}</div>
    <div class="card section" id="s-example">
      <div class="code-head"><h3><span class="num">03</span> Example</h3><button class="btn blue" id="tryEx" data-py disabled>▶ Run it</button></div>
      ${codeBlock(l.example)}
      <div id="exOut" hidden>${consoleHTML("exCon", "example output")}</div>
    </div>
    <div class="card section trap" id="s-trap"><div class="tape"></div><div class="inner"><h3><span class="num">04</span> Exam trap</h3><p>${esc(l.gotcha)}</p></div></div>
    ${l.task ? `
    <div class="card section" id="s-task"><h3><span class="num">05</span> Your turn</h3><p>${esc(l.task)}</p>
      <div class="editor"><div class="gutter" aria-hidden="true"></div>
        <div class="code-area"><pre class="hl" aria-hidden="true"></pre>
          <textarea id="code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Your code">${esc(l.starter)}</textarea></div></div>
      <div class="row">
        <button class="btn" id="run" data-py disabled>▶ Run</button>
        <button class="btn primary" id="check" data-py disabled>✔ Check answer</button>
        ${l.hint ? `<button class="btn ghost" id="hint">💡 Hint</button>` : ""}
        <button class="btn ghost" id="sol">👀 Solution</button>
        <button class="btn ghost" id="reset">↺ Reset</button>
      </div>
      <p class="small muted" style="margin-top:8px"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run · <kbd>Tab</kbd> indents · auto-indent after <code>:</code></p>
      <p class="small" id="pyStatus"></p>
      ${consoleHTML("out", "console")}
    </div>` : `<p class="small" id="pyStatus"></p>`}
    <div class="card section" id="s-quiz"><h3><span class="num">${l.task ? "06" : "05"}</span> Quick check</h3>${quizHTML(l.quiz, "")}</div>
    <div class="row">
      ${!l.task && opts.review == null ? `<button class="btn primary" id="markRead">✔ Mark as learned</button>` : ""}
      <button class="btn ghost" id="share">🔗 Share this lesson</button>
    </div>
    <div class="lesson-nav">
      ${opts.review != null ? `<a class="next" href="#review"><small>Up next</small><b>${opts.review ? "Next review →" : "Finish review →"}</b></a>` : `
      ${prev ? `<a href="#${prev.id}"><small>← Previous</small><b>${esc(prev.title)}</b></a>` : ""}
      ${next ? `<a class="next" href="#${next.id}"><small>Next →</small><b>${esc(next.title)}</b></a>` : `<a class="next" href="#exam"><small>Finished the path</small><b>Take the exam →</b></a>`}`}
    </div>`, true);

  setPyStatus(pyLoaded);
  wireStepper();

  $("#tryEx").onclick = async () => {
    const box = $("#exCon");
    $("#exOut").hidden = false;
    showOutput(box, null);
    showOutput(box, await runPython(l.example));
  };

  // Quiz: all correct marks a task-less lesson as done; any wrong answer sends a done lesson back for review
  let right = 0, answered = 0;
  wireQuiz($("#main"), l.quiz, "", (ok) => {
    answered++; if (ok) right++;
    if (answered < l.quiz.length) return;
    const all = right === answered;
    if (opts.onQuizDone) return opts.onQuizDone(right, answered);
    gainXP(right * XP.quiz);
    if (!l.task && all) {
      const r = recordLesson(l.id, true, XP.read);
      if (r.firstTime) return celebrate(l, XP.read + right * XP.quiz, r.leveledUp);
    } else if (!all && store.get().lessons[l.id]?.done) recordLesson(l.id, false);
    toast(all ? `Quiz ${right}/${answered} 🎉 +${right * XP.quiz} XP` : `Quiz ${right}/${answered}. Re-read the trap box, it's a classic.`);
  });

  $("#share").onclick = async () => {
    const url = location.origin + location.pathname + "#" + l.id;
    try {
      if (navigator.share) await navigator.share({ title: `PyDaily · ${l.title}`, text: `Learn "${l.title}" in 5 minutes`, url });
      else { await navigator.clipboard.writeText(url); toast("🔗 Link copied!"); }
    } catch {}
  };
  if ($("#markRead")) $("#markRead").onclick = () => {
    const r = recordLesson(l.id, true, isDone(store.get(), l.id) ? 0 : XP.read);
    if (r.firstTime) celebrate(l, XP.read, r.leveledUp); else toast("Marked as learned ✅");
  };

  if (!l.task) return;
  const code = $("#code"), out = $("#out");
  const draftKey = "pydaily.draft." + l.id;
  try { const saved = localStorage.getItem(draftKey); if (saved) code.value = saved; } catch {}
  const sync = mountEditor(code, () => { try { localStorage.setItem(draftKey, code.value); } catch {} });
  addEventListener("resize", sync, { once: true });
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#run").click(); }
  });

  $("#run").onclick = async () => {
    showOutput(out, null);
    showOutput(out, await runPython(code.value));
  };
  $("#check").onclick = async () => {
    showOutput(out, null);
    const r = await runPython(code.value + "\n" + (l.hidden || ""));
    const ok = !r.error && norm(r.out) === norm(l.expected);
    showOutput(out, r, ok ? "🎉 Correct! Lesson complete." : "Expected output:\n" + l.expected, ok ? "ok" : "bad");
    if (!ok) return;
    const first = !isDone(store.get(), l.id);
    const rec = recordLesson(l.id, true, first ? XP.task : 10);
    if (rec.firstTime) celebrate(l, XP.task, rec.leveledUp);
    else toast("✅ Still got it! +10 XP");
  };
  if ($("#hint")) $("#hint").onclick = () => toast("💡 " + l.hint);
  $("#sol").onclick = () => {
    const b = $("#sol");
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "👀 Click again to reveal"; return; }
    code.value = l.solution; code.dispatchEvent(new Event("input"));
  };
  $("#reset").onclick = () => {
    code.value = l.starter; code.dispatchEvent(new Event("input"));
    out.className = "console"; $(".status", out).textContent = "";
    $("pre", out).innerHTML = `<span class="muted">Output appears here…</span>`;
  };
}

// highlights the section you're reading and lets you jump between them
function wireStepper() {
  const btns = $$(".stepper button");
  btns.forEach((b) => (b.onclick = () => $("#" + b.dataset.to).scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" })));
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = btns.findIndex((b) => b.dataset.to === e.target.id);
      btns.forEach((b, k) => { b.classList.toggle("active", k === i); if (k <= i) b.classList.add("seen"); });
      btns[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, { rootMargin: "-140px 0px -55% 0px" });
  $$(".section").forEach((s) => observer.observe(s));
}

// ───────────── review ─────────────
function viewReview() {
  const due = dueLessons();
  if (!due.length) {
    const any = Object.values(store.get().lessons).some((s) => s.done);
    const next = nextLesson();
    setView(`<div class="card empty">
        <div class="big-emoji">🌿</div>
        <div class="eyebrow" style="margin-top:10px">Spaced review</div>
        <h1 class="lesson-title">Nothing due right now</h1>
        <p class="muted" style="max-width:52ch;margin:0 auto">${any
          ? "Each finished lesson comes back after 1, 3, 7, 14, then 30 days. Get it right and the gap grows; miss it and it comes back tomorrow."
          : "Finish a lesson first. It shows up here tomorrow so it sticks."}</p>
        <div class="row" style="justify-content:center;margin-top:18px">
          ${next ? `<a class="btn primary" href="#${next.id}">Next new lesson →</a>` : ""}
          <a class="btn" href="#exam">📝 Take the exam</a></div></div>`, true);
    return;
  }
  const l = LESSONS.find((x) => x.id === due[0]);
  viewLesson(l, {
    review: due.length - 1,
    onQuizDone(right, total) {
      const all = right === total;
      recordLesson(l.id, all, all ? XP.review : 0);
      toast(all ? `🔁 Locked in! +${XP.review} XP. Next review in ${REVIEW_GAPS[store.get().lessons[l.id].level]} days.` : "Comes back tomorrow. That's how it sticks.");
    },
  });
}

// ───────────── exam ─────────────
let keyHandler = null;

function viewExam(session) {
  const pool = LESSONS.filter((l) => !session || l.session === session)
    .flatMap((l) => l.quiz.map((q) => ({ ...q, lesson: l })));
  const qs = pool.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 10);
  let i = 0, score = 0, combo = 0, answered = false;
  const results = [];
  const missed = new Map();
  const label = session ? `Session ${session} · ${SESSIONS[session]}` : "All sessions";

  function finish() {
    keyHandler = null;
    const d = store.get();
    const pass = score >= Math.ceil(qs.length * 0.7);
    const best = qs.length === 10 && score > d.examBest;
    if (best) d.examBest = score;
    if (pass) bumpStreak(d);
    const xp = score * XP.exam + (pass ? XP.examPass : 0);
    const up = addXP(d, xp);
    store.set(d);
    renderStats();
    if (pass) confetti();
    if (up) toast(`⭐ Level up! You're now level ${levelOf(d.xp).level}`);
    const pct = score / qs.length;
    setView(`<div class="card result">
        ${ring(pct, 150, 16, pct >= .7 ? "var(--green)" : pct >= .4 ? "var(--yellow)" : "var(--red)", `${score}/${qs.length}`)}
        <h1>${score === qs.length ? "Flawless 🏆" : pass ? "You passed 🎉" : "Good practice 📚"}</h1>
        <p class="muted">${esc(label)}${best ? " · new personal best!" : ""}</p>
        <div class="row"><span class="chip">+${xp} XP</span>${pass ? `<span class="chip hot"><span class="flame">🔥</span>streak counted</span>` : ""}</div>
        ${missed.size ? `<div class="missed"><b>Revise these:</b>${[...missed.values()].map((l) => `<a href="#${l.id}"><span>${esc(l.title)}</span><span class="muted small">S${l.session} →</span></a>`).join("")}</div>`
          : `<p style="margin-top:14px">Nothing to revise. Show off a little 😎</p>`}
        <div class="row" style="margin-top:22px"><button class="btn primary" id="again">↻ New exam</button>
          <button class="btn" id="shareScore">🔗 Challenge a friend</button></div></div>`, true);
    $("#again").onclick = () => viewExam(session);
    $("#shareScore").onclick = async () => {
      const url = location.origin + location.pathname + "#exam" + (session ? "-" + session : "");
      const text = `I scored ${score}/${qs.length} on the PyDaily Python exam (${label}). Can you beat me?`;
      try {
        if (navigator.share) await navigator.share({ title: "PyDaily exam", text, url });
        else { await navigator.clipboard.writeText(text + " " + url); toast("Copied! Paste it to a friend."); }
      } catch {}
    };
  }

  function show() {
    if (i >= qs.length) return finish();
    answered = false;
    const q = qs[i];
    setView(`<div class="exam-top">
        <a class="btn ghost" href="#" aria-label="Quit exam">✕</a>
        <div><div class="eyebrow">Exam · ${esc(label)}</div><h1>Question ${i + 1} of ${qs.length}</h1></div>
        <span class="combo ${combo >= 2 ? "fire" : ""}" id="combo">${combo >= 2 ? `🔥 ${combo} in a row` : `Score ${score}`}</span>
      </div>
      <div class="segs" style="--n:${qs.length}">${qs.map((_, k) => `<i class="${results[k] || (k === i ? "now" : "")}"></i>`).join("")}</div>
      <div class="card exam-card"><div class="from">From: ${esc(q.lesson.title)}</div>${quizHTML([q], "e", "1234")}
        <div class="row"><button class="btn primary big" id="nextQ" hidden>${i + 1 === qs.length ? "See result" : "Next →"}</button>
        <span class="small muted" id="keysHint">Press <kbd>1</kbd>–<kbd>${q.options.length}</kbd> to answer</span></div></div>`, true);
    wireQuiz($("#main"), [q], "e", (ok) => {
      answered = true;
      results[i] = ok ? "ok" : "no";
      if (ok) { score++; combo++; } else {
        combo = 0;
        missed.set(q.lesson.id, q.lesson);
        if (store.get().lessons[q.lesson.id]?.done) recordLesson(q.lesson.id, false);
      }
      $(".segs i:nth-child(" + (i + 1) + ")").className = results[i];
      const c = $("#combo");
      c.className = "combo" + (combo >= 2 ? " fire" : "");
      c.textContent = combo >= 2 ? `🔥 ${combo} in a row` : `Score ${score}`;
      $("#keysHint").innerHTML = `Press <kbd>Enter</kbd> to continue`;
      $("#nextQ").hidden = false; $("#nextQ").focus();
    });
    $("#nextQ").onclick = () => { i++; show(); };
    keyHandler = (e) => {
      if (!answered && /^[1-9]$/.test(e.key)) $(`.opt[data-o="${+e.key - 1}"]`)?.click();
      else if (answered && (e.key === "ArrowRight")) $("#nextQ").click();
    };
  }
  show();
}

// ───────────── command palette ─────────────
let palSel = 0;
function openPalette() {
  const p = $("#palette");
  p.hidden = false;
  const input = $("#paletteInput");
  input.value = "";
  palSel = 0;
  renderPalette();
  input.focus();
}
function paletteItems() {
  const q = $("#paletteInput").value.trim().toLowerCase();
  const extra = [
    { href: "#", title: "🗺️ Learning path", sub: "home" },
    { href: "#review", title: "🔁 Review due lessons", sub: "review" },
    { href: "#exam", title: "📝 Exam: all sessions", sub: "exam" },
  ];
  const d = store.get();
  const lessons = LESSONS.map((l) => ({ href: "#" + l.id, title: l.title, sub: "S" + l.session, done: isDone(d, l.id), hay: (l.title + " " + SESSIONS[l.session] + " " + l.meaning + " " + l.syntax).toLowerCase(), t: l.title.toLowerCase() }));
  if (!q) return extra.concat(lessons);
  const words = q.split(/\s+/);
  return extra.filter((x) => x.title.toLowerCase().includes(q))
    .concat(lessons.filter((l) => words.every((w) => l.hay.includes(w))).sort((a, b) => (b.t.includes(q) ? 1 : 0) - (a.t.includes(q) ? 1 : 0)));
}
function renderPalette() {
  const items = paletteItems();
  palSel = Math.max(0, Math.min(palSel, items.length - 1));
  $("#paletteList").innerHTML = items.length ? items.map((x, k) => `<a class="p-item ${k === palSel ? "sel" : ""}" href="${x.href}" role="option">
      ${x.done != null ? `<span class="dot ${x.done ? "on" : ""}"></span>` : ""}${esc(x.title)}<small>${x.sub}</small></a>`).join("")
    : `<p class="muted small" style="padding:10px 12px">No lesson matches that. Try "list" or "loop".</p>`;
  $(".p-item.sel")?.scrollIntoView({ block: "nearest" });
}
$("#paletteInput").addEventListener("input", () => { palSel = 0; renderPalette(); });
$("#paletteInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); palSel++; renderPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPalette(); }
  else if (e.key === "Enter") { e.preventDefault(); const a = $(".p-item.sel"); if (a) { location.hash = a.getAttribute("href"); closeOverlays(); if (a.getAttribute("href") === "#" ) route(); } }
});
$("#paletteList").addEventListener("click", (e) => { if (e.target.closest(".p-item")) closeOverlays(); });
$("#palette").addEventListener("click", (e) => { if (e.target.id === "palette") closeOverlays(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeOverlays(); });

// ───────────── router ─────────────
function route() {
  closeOverlays();
  if (observer) { observer.disconnect(); observer = null; }
  keyHandler = null;
  const r = location.hash.slice(1);
  renderSidebar();
  renderStats();
  if (!r) viewHome();
  else if (r === "review") viewReview();
  else if (r === "exam") viewExam(0);
  else if (/^exam-\d+$/.test(r) && SESSIONS[r.slice(5)]) viewExam(+r.slice(5));
  else {
    const l = LESSONS.find((x) => x.id === r);
    l ? viewLesson(l) : viewHome();
  }
  window.scrollTo(0, 0);
}

// ───────────── theme, menu, shortcuts ─────────────
(function initChrome() {
  let t = null;
  try { t = localStorage.getItem("pydaily.theme"); } catch {}
  if (t) document.documentElement.dataset.theme = t;
  $("#themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const nt = dark ? "light" : "dark";
    document.documentElement.dataset.theme = nt;
    try { localStorage.setItem("pydaily.theme", nt); } catch {}
  };
  $("#menuBtn").onclick = () => document.body.classList.toggle("nav-open");
  $("#closeDrawer").onclick = closeOverlays;
  $("#scrim").onclick = closeOverlays;
  $("#searchBtn").onclick = openPalette;
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); openPalette(); }
    else if (e.key === "Escape") closeOverlays();
    else if (keyHandler && !typing && $("#modal").hidden && $("#palette").hidden) keyHandler(e);
  });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if ($(".trail")) drawTrails(); }, 120); });
  document.fonts?.ready.then(() => { if ($(".trail")) drawTrails(); });
})();

startWorker();
window.addEventListener("hashchange", route);
route();
