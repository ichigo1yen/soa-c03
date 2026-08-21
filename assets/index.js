/* =========================================================
   index.js
   data/manifest.json を読み込み、問題セット一覧をカード表示する。
   各カードには localStorage の回答済み件数から進捗バーを表示する。
   ========================================================= */

(function () {
  "use strict";

  const STORAGE_KEY = "quizProgress.v1";
  const MANIFEST_URL = "data/manifest.json";

  const grid = document.getElementById("set-grid");
  const overallSummary = document.getElementById("overall-summary");

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function escapeHTML(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function main() {
    let manifest;
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-store" });
      manifest = await res.json();
    } catch (e) {
      grid.innerHTML = `<li class="empty-state">data/manifest.json を読み込めませんでした。</li>`;
      return;
    }

    const sets = manifest.sets || [];
    if (!sets.length) {
      grid.innerHTML = `
        <li class="empty-state" style="grid-column: 1 / -1;">
          まだ問題セットが登録されていません。<br>
          <code>tools/convert_htm_to_json.py</code> で問題データを変換し、
          <code>data/</code> フォルダに JSON を追加してください。
        </li>`;
      return;
    }

    const progress = loadProgress();
    let totalQ = 0, totalAnswered = 0;

    grid.innerHTML = sets
      .map((s) => {
        const p = progress[s.id] || {};
        const answered = Object.values(p).filter((v) => v.selected && v.selected.length).length;
        const pct = s.count ? Math.round((answered / s.count) * 100) : 0;
        totalQ += s.count || 0;
        totalAnswered += answered;
        return `
          <li>
            <a class="set-card" href="quiz.html?set=${encodeURIComponent(s.id)}">
              <span class="set-id">#${escapeHTML(s.id)}</span>
              <div class="set-name">${escapeHTML(s.title || s.id)}</div>
              <div class="set-meta"><span>${s.count || 0} 問</span><span>${answered}/${s.count || 0} 回答済み</span></div>
              <div class="progress-bar"><span style="width:${pct}%"></span></div>
            </a>
          </li>`;
      })
      .join("");

    overallSummary.textContent = `全 ${sets.length} セット ・ 全 ${totalQ} 問中 ${totalAnswered} 問に回答済み`;
  }

  main();
})();
