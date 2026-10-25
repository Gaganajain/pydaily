// ───────────── helpers ─────────────
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => String(s).trim().split("\n").map((x) => x.trimEnd()).join("\n");
const DAY = 86400000;
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA"); // YYYY-MM-DD local
const REVIEW_GAPS = [1, 3, 7, 14, 30]; // days until a lesson is due again, per mastery level

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ───────────── storage ─────────────
const KEY = "pydaily.v1";
const blank = () => ({ lessons: {}, streak: 0, best: 0, lastDay: null, examBest: 0, days: {} });
const store = {
  get() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch { return blank(); }
  },
  set(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} },
};

function bumpStreak(d) {
  const today = dayKey();
  d.days[today] = (d.days[today] || 0) + 1;
  if (d.lastDay === today) return;
  d.streak = d.lastDay === dayKey(Date.now() - DAY) ? d.streak + 1 : 1;
  d.best = Math.max(d.best, d.streak);
  d.lastDay = today;
}

// correct=true moves a lesson up a mastery level; false sends it back to level 0
function recordLesson(id, correct) {
  const d = store.get();
  const prev = d.lessons[id];
  const level = correct ? (prev ? Math.min(prev.level + 1, REVIEW_GAPS.length - 1) : 0) : 0;
  d.lessons[id] = { level, seen: Date.now(), done: correct || (prev && prev.done) || false };
  if (correct) bumpStreak(d);
  store.set(d);
  renderStats();
  renderSidebar();
}

function dueLessons() {
  const d = store.get();
  return Object.entries(d.lessons)
    .filter(([id, s]) => s.done && LESSONS.some((l) => l.id === id))
    .filter(([, s]) => Date.now() - s.seen >= REVIEW_GAPS[s.level] * DAY)
    .sort((a, b) => a[1].seen - b[1].seen)
    .map(([id]) => id);
}

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
  workerReady.then(() => setPyStatus(true), () => setPyStatus(false, true));
}
function setPyStatus(ok, failed) {
  document.querySelectorAll("[data-py]").forEach((b) => (b.disabled = !ok));
  const s = $("#pyStatus");
  if (s) s.textContent = failed ? "Python failed to load. Check your connection and refresh." : ok ? "" : "Loading Python (first visit takes ~10 s)…";
}
function runPython(code, timeoutMs = 5000) {
  return workerReady.then(() => new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      delete pending[id];
      worker.terminate();
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
  const done = Object.values(d.lessons).filter((s) => s.done).length;
  const due = dueLessons().length;
  $("#stats").innerHTML = `
    <span class="pill" title="Days in a row">🔥 ${d.streak} day${d.streak === 1 ? "" : "s"}</span>
    <span class="pill hide-sm">✅ ${done}/${LESSONS.length}</span>
    ${due ? `<a class="pill" href="#review" style="text-decoration:none">🔁 ${due} to review</a>` : ""}`;
}

function renderSidebar() {
  const d = store.get();
  const route = location.hash.slice(1);
  let html = `<div class="tools">
      <a href="#">🏠 Today</a>
      <a href="#review">🔁 Review due lessons</a>
      <a href="#exam">📝 Exam mode (all sessions)</a>
    </div>`;
  for (const s of Object.keys(SESSIONS).map(Number)) {
    const ls = LESSONS.filter((l) => l.session === s);
    const n = ls.filter((l) => d.lessons[l.id]?.done).length;
    html += `<div class="sess"><h4>S${s} · ${esc(SESSIONS[s])}</h4><span>${n}/${ls.length}</span></div>`;
    html += ls.map((l) => {
      const done = d.lessons[l.id]?.done;
      return `<a class="item ${done ? "done" : ""} ${route === l.id ? "active" : ""}" href="#${l.id}">
        <span class="tick">${done ? "✓" : ""}</span>${esc(l.title)}</a>`;
    }).join("");
  }
  $("#sidebar").innerHTML = html;
}

// ───────────── views ─────────────
function nextLesson() {
  const d = store.get();
  return LESSONS.find((l) => !d.lessons[l.id]?.done);
}

function viewHome() {
  const d = store.get();
  const done = Object.values(d.lessons).filter((s) => s.done).length;
  const pct = Math.round((done / LESSONS.length) * 100);
  const next = nextLesson();
  const due = dueLessons();
  const doneToday = (d.days[dayKey()] || 0) > 0;
  $("#main").innerHTML = `
    <section class="hero">
      <div class="eyebrow">Python revision, 10 minutes a day</div>
      <h1>Learn it once. Keep it forever.</h1>
      <p>Every lesson gives you the meaning in plain words, the syntax, a runnable example, the exam trap, a coding task and a quick quiz. Lessons you finish come back for review right before you'd forget them.</p>
    </section>
    <div class="grid">
      <div class="stat"><b>🔥 ${d.streak}</b><span>day streak${d.best ? ` · best ${d.best}` : ""}</span></div>
      <div class="stat"><b>${done}/${LESSONS.length}</b><span>lessons done</span><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="stat"><b>${due.length}</b><span>due for review</span></div>
      <div class="stat"><b>${d.examBest}/10</b><span>best exam score</span></div>
    </div>
    <div class="card">
      <h3>📅 Today's plan ${doneToday ? "· ✅ streak kept!" : ""}</h3>
      <ol class="plan">
        <li>${next ? `Learn: <a href="#${next.id}">${esc(next.title)}</a>` : "All lessons done 🎉 Keep reviewing!"}</li>
        <li>${due.length ? `Review: <a href="#review">${due.length} lesson${due.length > 1 ? "s" : ""} due</a>` : "Review: nothing due today"}</li>
        <li>Test yourself: <a href="#exam">10-question exam</a></li>
      </ol>
      <div class="row">${next ? `<a class="btn primary" href="#${next.id}" style="text-decoration:none">Start today's lesson →</a>` : ""}</div>
    </div>
    <h2>Sessions</h2>
    <div class="sessions">
      ${Object.keys(SESSIONS).map(Number).map((s) => {
        const ls = LESSONS.filter((l) => l.session === s);
        const n = ls.filter((l) => d.lessons[l.id]?.done).length;
        const first = ls.find((l) => !d.lessons[l.id]?.done) || ls[0];
        return `<a href="#${first.id}"><div class="card">
          <div class="eyebrow">Session ${s}</div>
          <h3>${esc(SESSIONS[s])}</h3>
          <p class="kbd">${n}/${ls.length} lessons · <span onclick="event.preventDefault();location.hash='exam-${s}'" style="color:var(--accent);cursor:pointer">exam this session</span></p>
          <div class="bar"><i style="width:${Math.round((n / ls.length) * 100)}%"></i></div>
        </div></a>`;
      }).join("")}
    </div>`;
}

function quizHTML(quiz, prefix) {
  return quiz.map((q, i) => `
    <div class="q" data-q="${prefix}${i}">
      ${/[?.]$/.test(q.q.trim()) ? `<p class="qtext">${esc(q.q)}</p>` : `<p class="kbd">What does this print?</p><pre>${esc(q.q)}</pre>`}
      <div class="opts">${q.options.map((o, j) => `<button class="opt" data-o="${j}">${esc(o)}</button>`).join("")}</div>
      <div class="why"></div>
    </div>`).join("");
}

function wireQuiz(root, quiz, prefix, onAnswer) {
  quiz.forEach((q, i) => {
    const box = root.querySelector(`[data-q="${prefix}${i}"]`);
    box.querySelectorAll(".opt").forEach((b) => (b.onclick = () => {
      const ok = +b.dataset.o === q.answer;
      box.querySelectorAll(".opt").forEach((x) => (x.disabled = true));
      b.classList.add(ok ? "right" : "wrong");
      if (!ok) box.querySelector(`[data-o="${q.answer}"]`).classList.add("right");
      box.querySelector(".why").textContent = (ok ? "✅ Correct. " : "❌ Not quite. ") + q.why;
      onAnswer && onAnswer(ok);
    }));
  });
}

function viewLesson(l, opts = {}) {
  const idx = LESSONS.indexOf(l);
  const prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
  const reviewNote = opts.review ? `<div class="card" style="border-color:var(--accent)"><b>🔁 Review mode</b> · ${opts.review} left after this one. Do the quiz or the task to lock it in.</div>` : "";
  $("#main").innerHTML = `
    ${reviewNote}
    <div class="eyebrow">Session ${l.session} · ${esc(SESSIONS[l.session])}</div>
    <h1 class="lesson-title">${esc(l.title)}</h1>
    <div class="card"><h3>📖 Meaning</h3><p>${esc(l.meaning)}</p></div>
    <div class="card"><h3>🧩 Syntax</h3><pre>${esc(l.syntax)}</pre></div>
    <div class="card"><h3>💡 Example</h3><pre>${esc(l.example)}</pre>
      <div class="row"><button class="btn" id="tryEx" data-py disabled>▶ Run example</button></div>
      <pre class="out" id="exOut" hidden></pre></div>
    <div class="card trap"><h3>⚠️ Exam trap</h3><p>${esc(l.gotcha)}</p></div>
    ${l.task ? `
    <div class="card"><h3>🎯 Your turn</h3><p>${esc(l.task)}</p>
      <textarea class="editor" id="code" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(l.starter)}</textarea>
      <div class="row">
        <button class="btn" id="run" data-py disabled>▶ Run</button>
        <button class="btn primary" id="check" data-py disabled>✔ Check answer</button>
        ${l.hint ? `<button class="btn" id="hint">💡 Hint</button>` : ""}
        <button class="btn" id="sol">👀 Solution</button>
        <button class="btn" id="reset">↺ Reset</button>
        <span class="kbd">Ctrl/⌘ + Enter to run · Tab indents</span>
      </div>
      <p class="kbd" id="pyStatus"></p>
      <pre class="out" id="out">Output appears here…</pre>
    </div>` : `<p class="kbd" id="pyStatus"></p>`}
    <div class="card"><h3>🧠 Quick check</h3>${quizHTML(l.quiz, "")}</div>
    <div class="row">
      <button class="btn" id="share">🔗 Share this lesson</button>
      ${!l.task ? `<button class="btn primary" id="markRead">✔ Mark as learned</button>` : ""}
    </div>
    <div class="lesson-nav">
      ${opts.review ? `<a class="btn primary" href="#review">Next review →</a>` : `
      ${prev ? `<a class="btn" href="#${prev.id}">← ${esc(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a class="btn" href="#${next.id}">${esc(next.title)} →</a>` : `<a class="btn" href="#exam">Take the exam →</a>`}`}
    </div>`;

  setPyStatus(pyLoaded);

  // Example runner
  $("#tryEx").onclick = async () => {
    const o = $("#exOut");
    o.hidden = false; o.textContent = "Running…"; o.className = "out";
    const r = await runPython(l.example);
    o.textContent = (r.out || "") + (r.error ? (r.out ? "\n" : "") + "⚠ " + r.error : "") || "(no output)";
  };

  // Quiz: all correct marks a task-less lesson as done; any answer counts for review
  let right = 0, answered = 0;
  wireQuiz($("#main"), l.quiz, "", (ok) => {
    answered++; if (ok) right++;
    if (answered === l.quiz.length) {
      if (!l.task) recordLesson(l.id, right === answered);
      else if (right < answered && store.get().lessons[l.id]?.done) recordLesson(l.id, false);
      toast(right === answered ? `Quiz: ${right}/${answered} 🎉` : `Quiz: ${right}/${answered}. Read the trap box again.`);
    }
  });

  $("#share").onclick = async () => {
    const url = location.origin + location.pathname + "#" + l.id;
    try {
      if (navigator.share) await navigator.share({ title: `PyDaily · ${l.title}`, text: `Learn "${l.title}" in 5 minutes`, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied!"); }
    } catch {}
  };
  if ($("#markRead")) $("#markRead").onclick = () => { recordLesson(l.id, true); toast("Marked as learned ✅"); };

  if (!l.task) return;
  const code = $("#code"), out = $("#out");
  const draftKey = "pydaily.draft." + l.id;
  try { const saved = localStorage.getItem(draftKey); if (saved) code.value = saved; } catch {}
  code.addEventListener("input", () => { try { localStorage.setItem(draftKey, code.value); } catch {} });
  code.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); code.setRangeText("    ", code.selectionStart, code.selectionEnd, "end"); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#run").click(); }
  });

  const show = (r, verdict) => {
    let text = r.out || "";
    if (r.error) text += (text ? "\n" : "") + "⚠ " + r.error;
    out.textContent = (text || "(no output)") + (verdict ? "\n\n" + verdict : "");
  };
  $("#run").onclick = async () => {
    out.className = "out"; out.textContent = "Running…";
    show(await runPython(code.value));
  };
  $("#check").onclick = async () => {
    out.className = "out"; out.textContent = "Checking…";
    const r = await runPython(code.value + "\n" + (l.hidden || ""));
    const ok = !r.error && norm(r.out) === norm(l.expected);
    out.className = "out " + (ok ? "ok" : "bad");
    show(r, ok ? "🎉 Correct! Lesson complete." : "❌ Not yet. Expected output:\n" + l.expected);
    if (ok) { recordLesson(l.id, true); toast("Lesson complete ✅ +1 day on your streak"); }
  };
  if ($("#hint")) $("#hint").onclick = () => toast("💡 " + l.hint);
  $("#sol").onclick = () => {
    if (!confirmSolution()) return;
    code.value = l.solution; code.dispatchEvent(new Event("input"));
  };
  $("#reset").onclick = () => { code.value = l.starter; code.dispatchEvent(new Event("input")); out.className = "out"; out.textContent = "Output appears here…"; };
}
function confirmSolution() {
  const b = $("#sol");
  if (b.dataset.armed) return true;
  b.dataset.armed = "1"; b.textContent = "👀 Click again to reveal";
  return false;
}

function viewReview() {
  const due = dueLessons();
  if (!due.length) {
    const d = store.get();
    const any = Object.values(d.lessons).some((s) => s.done);
    $("#main").innerHTML = `<div class="eyebrow">Spaced review</div><h1 class="lesson-title">Nothing due right now 🌿</h1>
      <div class="card"><p>${any
        ? "Each lesson you finish comes back after 1, 3, 7, 14, then 30 days. Get it right and the gap grows; get it wrong and it comes back tomorrow. Come back tomorrow, or take the exam now."
        : "Finish a lesson first. It will come back here tomorrow so it sticks."}</p>
      <div class="row"><a class="btn primary" href="#exam" style="text-decoration:none">Take the exam</a>
      ${nextLesson() ? `<a class="btn" href="#${nextLesson().id}" style="text-decoration:none">Next new lesson</a>` : ""}</div></div>`;
    return;
  }
  const l = LESSONS.find((x) => x.id === due[0]);
  viewLesson(l, { review: due.length - 1 });
  // In review, the quiz result decides the next gap
  let right = 0, answered = 0;
  wireQuiz($("#main"), l.quiz, "", (ok) => {
    answered++; if (ok) right++;
    if (answered === l.quiz.length) recordLesson(l.id, right === answered);
  });
}

function viewExam(session) {
  const pool = LESSONS.filter((l) => !session || l.session === session)
    .flatMap((l) => l.quiz.map((q) => ({ ...q, lesson: l })));
  const qs = pool.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, 10);
  let i = 0, score = 0;
  const missed = new Map();
  const label = session ? `Session ${session} · ${SESSIONS[session]}` : "All sessions";

  function show() {
    if (i >= qs.length) {
      const d = store.get();
      if (qs.length === 10 && score > d.examBest) { d.examBest = score; store.set(d); }
      if (score >= Math.ceil(qs.length * 0.7)) { const d2 = store.get(); bumpStreak(d2); store.set(d2); }
      renderStats();
      $("#main").innerHTML = `<div class="eyebrow">Exam · ${esc(label)}</div>
        <h1 class="lesson-title">You scored ${score}/${qs.length} ${score === qs.length ? "🏆" : score >= qs.length * 0.7 ? "🎉" : "📚"}</h1>
        <div class="card"><h3>${missed.size ? "Revise these" : "Perfect, nothing to revise"}</h3>
          ${[...missed.values()].map((l) => `<p>→ <a href="#${l.id}">${esc(l.title)}</a> <span class="kbd">(Session ${l.session})</span></p>`).join("")}
          <div class="row"><button class="btn primary" id="again">New exam</button>
          <button class="btn" id="shareScore">🔗 Challenge a friend</button></div></div>`;
      $("#again").onclick = () => viewExam(session);
      $("#shareScore").onclick = async () => {
        const url = location.origin + location.pathname + "#exam" + (session ? "-" + session : "");
        const text = `I scored ${score}/${qs.length} on the PyDaily Python exam (${label}). Can you beat me?`;
        try {
          if (navigator.share) await navigator.share({ title: "PyDaily exam", text, url });
          else { await navigator.clipboard.writeText(text + " " + url); toast("Copied! Paste it to a friend."); }
        } catch {}
      };
      return;
    }
    const q = qs[i];
    $("#main").innerHTML = `<div class="eyebrow">Exam · ${esc(label)} · ${i + 1}/${qs.length} · score ${score}</div>
      <div class="bar" style="margin:8px 0 18px"><i style="width:${(i / qs.length) * 100}%"></i></div>
      <div class="card"><p class="kbd">From: ${esc(q.lesson.title)}</p>${quizHTML([q], "e")}
      <div class="row"><button class="btn primary" id="nextQ" hidden>${i + 1 === qs.length ? "See result" : "Next →"}</button></div></div>`;
    wireQuiz($("#main"), [q], "e", (ok) => {
      if (ok) score++; else { missed.set(q.lesson.id, q.lesson); if (store.get().lessons[q.lesson.id]?.done) recordLesson(q.lesson.id, false); }
      $("#nextQ").hidden = false; $("#nextQ").focus();
    });
    $("#nextQ").onclick = () => { i++; show(); };
  }
  show();
}

// ───────────── router ─────────────
function route() {
  document.body.classList.remove("nav-open");
  const r = location.hash.slice(1);
  renderSidebar();
  renderStats();
  if (!r) viewHome();
  else if (r === "review") viewReview();
  else if (r === "exam") viewExam(0);
  else if (/^exam-[1-4]$/.test(r)) viewExam(+r.slice(5));
  else {
    const l = LESSONS.find((x) => x.id === r);
    l ? viewLesson(l) : viewHome();
  }
  window.scrollTo(0, 0);
}

// ───────────── theme + menu ─────────────
(function initTheme() {
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
})();

startWorker();
workerReady.then(() => { pyLoaded = true; });
window.addEventListener("hashchange", route);
route();
