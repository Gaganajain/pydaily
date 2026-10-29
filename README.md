<div align="center">

# 🐍 PyDaily: learn Python a little every day

![Python](https://img.shields.io/badge/Python-in%20the%20browser-3776AB?logo=python&logoColor=white)
![Pyodide](https://img.shields.io/badge/Pyodide-WebAssembly-654FF0?logo=webassembly&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![GitHub Pages](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-222?logo=github)
![Free](https://img.shields.io/badge/free-no%20login-success)

**[🚀 Try it live](https://gaganajain.github.io/pydaily/)**

</div>

PyDaily is a free, interactive Python revision site. Every lesson explains a concept in plain words and lets you run real Python right in the browser. Nothing to install and no login.

**Live demo:** https://gaganajain.github.io/pydaily/

## What each lesson has

| Part | What it does |
|---|---|
| 📖 Meaning | The idea in plain English |
| 🧩 Syntax | The pattern to remember |
| 💡 Example | Real code you can run with one click |
| ⚠️ Exam trap | The mistake examiners love to test |
| 🎯 Your turn | A coding task, auto-graded against expected output |
| 🧠 Quick check | Predict-the-output quiz questions |

## Features

- **41 lessons** across 5 sessions: Basics, Logic & loops, Data structures, Functions & modules, Functional programming
- **Real Python in the browser** with [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), running in a Web Worker with a 5-second timeout, so an infinite loop can't freeze the page
- **Auto-grading**: hidden test code is appended to the learner's code to grade functions
- **Spaced repetition**: finished lessons come back after 1, 3, 7, 14, then 30 days; a wrong answer resets the gap
- **Exam mode**: 10 random questions from all sessions or one session, with a list of lessons to revise
- **Daily streak**, progress per session, and saved code drafts (stored in the browser)
- **Shareable links** for each lesson (`#loops`) and exam scores you can challenge friends with
- Dark mode and a mobile layout

## Tech

Plain HTML, CSS and JavaScript (no framework, no build step) · Pyodide/WebAssembly · Web Workers · localStorage · GitHub Pages

```
index.html   page shell
style.css    design (light and dark themes)
lessons.js   all lesson content (add a lesson = add one object)
app.js       routing, lesson view, grading, quiz, exam, streak, spaced repetition
worker.js    runs Python off the main thread
```

## Run locally

```bash
python -m http.server 8000
# open http://localhost:8000
```

(A server is needed because browsers block Web Workers on `file://` pages.)

## Add a lesson

Add an object to `LESSONS` in `lessons.js`:

```js
{
  id: "my-topic", session: 3, title: "My topic",
  meaning: "...", syntax: "...", example: "...", gotcha: "...",
  task: "...", starter: "...", expected: "...", solution: "...",
  quiz: [{ q: "print(1 + 1)", options: ["2", "11"], answer: 0, why: "..." }]
}
```

## Roadmap

- Accounts and cloud sync (FastAPI + PostgreSQL)
- SM-2 spaced repetition per question
- AI tutor that explains wrong answers
- More sessions as the course continues

## 👩‍💻 Author

**Gagana Jain A** · [GitHub](https://github.com/Gaganajain)

⭐ If PyDaily helps you learn, give it a star!
