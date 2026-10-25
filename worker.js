// Runs Python in a Web Worker so a slow or infinite loop never freezes the page.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

const ready = loadPyodide();

// input() can't pause a browser page, so explain that instead of a cryptic I/O error
const PRELUDE = `
def input(prompt=""):
    raise RuntimeError("input() doesn't work in the browser. Give the variable a value directly, e.g. age = 21")
`;

ready.then(() => postMessage({ type: "ready" }), (e) => postMessage({ type: "loadError", error: String(e) }));

function friendlyError(msg) {
  const lines = String(msg).trim().split("\n");
  const last = lines[lines.length - 1];
  let lineNo = null;
  for (const l of lines) {
    const m = l.match(/File "<exec>", line (\d+)/);
    if (m) lineNo = m[1];
  }
  if (last.includes("input() doesn't work")) return last.replace(/^RuntimeError: /, "");
  return (lineNo ? `Line ${lineNo}: ` : "") + last;
}

onmessage = async (e) => {
  const { id, code } = e.data;
  const py = await ready;
  let out = "";
  py.setStdout({ batched: (s) => (out += s + "\n") });
  py.setStderr({ batched: (s) => (out += s + "\n") });
  let error = null;
  try {
    // fresh namespace each run so old variables don't leak between attempts
    const ns = py.globals.get("dict")();
    ns.set("__name__", "__main__");
    py.runPython(PRELUDE, { globals: ns });
    await py.runPythonAsync(code, { globals: ns });
    ns.destroy();
  } catch (err) {
    error = friendlyError(err.message);
  }
  postMessage({ type: "result", id, out: out.replace(/\n$/, ""), error });
};
