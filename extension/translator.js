// Talks to a local Ollama server. Loaded by the service worker (importScripts)
// and by the Node tests.
(function (root) {
  const TIMEOUT_MS = 180000;

  async function ollamaChat(s, messages, format) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const base = String(s.ollamaUrl || "").replace(/\/+$/, "");
    try {
      const body = {
        model: s.model,
        messages,
        stream: false,
        keep_alive: "15m",
        options: { temperature: 0.1, num_ctx: 4096 }
      };
      if (format) body.format = format;
      const r = await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        if (r.status === 404 && /not found/i.test(t)) throw new Error(root.ytplT("errModelMissing", s.model));
        if (r.status === 403) throw new Error(root.ytplT("err403"));
        throw new Error(root.ytplT("errHttp", r.status, t.slice(0, 200)));
      }
      const j = await r.json();
      return (j.message && j.message.content) || "";
    } catch (e) {
      if (e.name === "AbortError") throw new Error(root.ytplT("errTimeout"));
      if (e instanceof TypeError) throw new Error(root.ytplT("errNoConnection", base));
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // L = { src, tgt } language codes
  const names = (L) => ({
    srcName: root.ytplLangName(L.src),
    srcCode: root.ytplBase(L.src) || "en",
    tgtName: root.ytplLangName(L.tgt),
    tgtCode: root.ytplBase(L.tgt)
  });

  // --- TranslateGemma: dedicated translation model, uses its own prompt format.
  // Lines go in separated by newlines; we expect the same number back.
  async function tgTranslate(s, lines, _context, L) {
    const { srcName, srcCode, tgtName, tgtCode } = names(L);
    const prompt =
      `You are a professional ${srcName} (${srcCode}) to ${tgtName} (${tgtCode}) translator. ` +
      `Your goal is to accurately convey the meaning and nuances of the original ${srcName} text ` +
      `while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.\n` +
      `Produce only the ${tgtName} translation, without any additional explanations or commentary. ` +
      `Please translate the following ${srcName} text into ${tgtName}:\n\n\n` +
      lines.join("\n");
    const out = await ollamaChat(s, [{ role: "user", content: prompt }], null);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  // --- Any general chat model (gemma3, qwen, Bielik, llama...): JSON with exact line count.
  async function jsonTranslate(s, lines, context, L) {
    const { srcName, tgtName } = names(L);
    const n = lines.length;
    const system =
      `You are a subtitle translator. Translate video subtitles from ${srcName} into natural, fluent, colloquial ${tgtName}.\n` +
      `Input is JSON: "context" = preceding subtitle lines (for reference only, do NOT translate them), ` +
      `"lines" = subtitle lines to translate. The lines are consecutive fragments of one transcript; ` +
      `a sentence may continue across lines. Translate so that each ${tgtName} line corresponds to its source line ` +
      `and the sequence reads naturally.\n` +
      `Return JSON {"lines": [...]} with EXACTLY ${n} strings in the same order. ` +
      `Never merge, split, skip or add lines. Keep names, numbers and technical terms. Output only JSON.`;
    const format = {
      type: "object",
      properties: { lines: { type: "array", items: { type: "string" }, minItems: n, maxItems: n } },
      required: ["lines"]
    };
    const out = await ollamaChat(s, [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ context, lines }) }
    ], format);
    try {
      const j = JSON.parse(out);
      return Array.isArray(j.lines) ? j.lines.map((x) => String(x).trim()) : null;
    } catch {
      return null;
    }
  }

  // Keeps 1:1 alignment between source and translated lines. If the model
  // returns a different number of lines, split the batch in half and retry.
  async function aligned(fn, s, lines, context, L) {
    const out = await fn(s, lines, context, L);
    if (out && out.length === lines.length) return out;
    if (lines.length === 1) return [(out && out.join(" ")) || lines[0]];
    const mid = Math.ceil(lines.length / 2);
    const left = await aligned(fn, s, lines.slice(0, mid), context, L);
    const ctx2 = context.concat(lines.slice(0, mid)).slice(-3);
    const right = await aligned(fn, s, lines.slice(mid), ctx2, L);
    return left.concat(right);
  }

  async function translateLines(s, lines, context, srcLang, tgtLang) {
    const fn = /translategemma/i.test(s.model) ? tgTranslate : jsonTranslate;
    const L = { src: srcLang || "en", tgt: tgtLang || root.ytplTargetLang(s) };
    return aligned(fn, s, lines, context || [], L);
  }

  async function listModels(s) {
    const base = String(s.ollamaUrl || "").replace(/\/+$/, "");
    let r;
    try { r = await fetch(base + "/api/tags"); }
    catch { throw new Error(root.ytplT("errNoConnection", base)); }
    if (r.status === 403) throw new Error(root.ytplT("err403"));
    if (!r.ok) throw new Error(root.ytplT("errHttp", r.status, ""));
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  }

  root.YTPL_translator = { translateLines, listModels };
})(typeof globalThis !== "undefined" ? globalThis : this);
