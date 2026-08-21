/* =========================================================
   quiz.js
   1つの問題セット(JSON)を読み込み、問題カードを描画する。
   ・回答を選択(ラジオ/チェックボックス)
   ・「解答を表示」ボタンで正解マークの表示/非表示をトグル
   ・選択結果と正誤を localStorage に保存し、次回訪問時も復元
   完全に静的なファイルのみで動作する(S3 + CloudFront 想定)。
   ========================================================= */

(function () {
  "use strict";

  const STORAGE_KEY = "quizProgress.v1";
  const DATA_DIR = "data/";
  const MANIFEST_URL = DATA_DIR + "manifest.json";

  const qs = new URLSearchParams(location.search);
  const setId = qs.get("set");

  const els = {
    setTitle: document.getElementById("set-title"),
    setSelect: document.getElementById("set-select"),
    prevLink: document.getElementById("prev-link"),
    nextLink: document.getElementById("next-link"),
    questionList: document.getElementById("question-list"),
    toggleAllBtn: document.getElementById("toggle-all-btn"),
    resetBtn: document.getElementById("reset-btn"),
    progressSummary: document.getElementById("progress-summary"),
    pagerBottom: document.getElementById("pager-bottom"),
  };

  // ---------- localStorage ヘルパー ----------
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveProgress(all) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      /* localStorage が使えない環境では静かに諦める(表示自体は継続可能) */
    }
  }

  function getSetProgress(all, id) {
    return all[id] || {};
  }

  // ---------- データ取得 ----------
  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- ナビゲーション(セット切替・前後リンク) ----------
  function buildNav(manifest, currentId) {
    const sets = manifest.sets || [];
    els.setSelect.innerHTML = sets
      .map((s) => `<option value="${s.id}" ${s.id === currentId ? "selected" : ""}>${escapeHTML(s.title || s.id)}</option>`)
      .join("");

    els.setSelect.addEventListener("change", () => {
      location.href = `quiz.html?set=${encodeURIComponent(els.setSelect.value)}`;
    });

    const idx = sets.findIndex((s) => s.id === currentId);
    const prev = idx > 0 ? sets[idx - 1] : null;
    const next = idx >= 0 && idx < sets.length - 1 ? sets[idx + 1] : null;

    if (prev) {
      els.prevLink.href = `quiz.html?set=${encodeURIComponent(prev.id)}`;
      els.prevLink.classList.remove("is-disabled");
      els.prevLink.removeAttribute("aria-disabled");
    } else {
      els.prevLink.removeAttribute("href");
      els.prevLink.setAttribute("aria-disabled", "true");
    }
    if (next) {
      els.nextLink.href = `quiz.html?set=${encodeURIComponent(next.id)}`;
      els.nextLink.classList.remove("is-disabled");
      els.nextLink.removeAttribute("aria-disabled");
    } else {
      els.nextLink.removeAttribute("href");
      els.nextLink.setAttribute("aria-disabled", "true");
    }
  }

  // ---------- 問題カードの描画 ----------
  function renderQuestion(q, savedState) {
    const card = document.createElement("li");
    card.className = "question";
    card.dataset.qid = q.id;

    const isMultiple = q.type === "multiple";
    const inputType = isMultiple ? "checkbox" : "radio";
    const groupName = `q-${q.id}`;

    const choicesHTML = q.choices
      .map((c) => {
        const isCorrect = q.correct.includes(c.letter);
        const checked = savedState.selected && savedState.selected.includes(c.letter);
        return `
          <li class="choice ${isCorrect ? "choice-correct-slot" : ""}" data-letter="${c.letter}" data-correct="${isCorrect}">
            <input type="${inputType}" name="${groupName}" value="${c.letter}" id="${groupName}-${c.letter}" ${checked ? "checked" : ""}>
            <label for="${groupName}-${c.letter}" class="choice-label" style="display:flex; gap:10px; flex:1; cursor:pointer;">
              <span class="choice-letter">${c.letter}.</span>
              <span class="choice-text">${escapeHTML(c.text)}</span>
            </label>
            <span class="answer-mark ${isCorrect ? "is-correct" : ""}">正解</span>
          </li>`;
      })
      .join("");

    card.innerHTML = `
      <div class="question-head">
        <span class="question-num">#${q.id}</span>
        <span class="question-type-badge">${isMultiple ? `複数選択 (${q.correct.length})` : "単一選択"}</span>
      </div>
      <p class="question-text">${escapeHTML(q.text)}</p>
      <ul class="choices">${choicesHTML}</ul>
      <div class="question-foot">
        <span class="question-result"></span>
        <button type="button" class="btn btn-outline btn-small reveal-btn">解答を表示</button>
      </div>
    `;

    if (savedState.revealed) card.classList.add("revealed");

    return card;
  }

  function currentSelection(card) {
    const inputs = card.querySelectorAll("input[type=radio], input[type=checkbox]");
    const selected = [];
    inputs.forEach((i) => { if (i.checked) selected.push(i.value); });
    return selected;
  }

  function isCorrectSelection(selected, correct) {
    if (selected.length === 0) return false;
    const a = [...selected].sort().join(",");
    const b = [...correct].sort().join(",");
    return a === b;
  }

  function updateResultLabel(card, q, revealed) {
    const resultEl = card.querySelector(".question-result");
    const selected = currentSelection(card);
    resultEl.classList.remove("is-correct-result", "is-wrong-result");
    if (!revealed) {
      resultEl.textContent = selected.length ? "選択済み" : "未回答";
      return;
    }
    if (selected.length === 0) {
      resultEl.textContent = "未回答(正解を表示中)";
      return;
    }
    const ok = isCorrectSelection(selected, q.correct);
    resultEl.textContent = ok ? "正解！" : "不正解";
    resultEl.classList.add(ok ? "is-correct-result" : "is-wrong-result");
  }

  function markWrongSelections(card) {
    card.querySelectorAll(".choice").forEach((li) => {
      const input = li.querySelector("input");
      const isCorrect = li.dataset.correct === "true";
      li.classList.toggle("is-correct", isCorrect);
      li.classList.toggle("is-selected-wrong", input.checked && !isCorrect);
    });
  }

  // ---------- メイン描画処理 ----------
  async function main() {
    let manifest;
    try {
      manifest = await fetchJSON(MANIFEST_URL);
    } catch (e) {
      els.questionList.innerHTML = `<li class="empty-state">manifest.json を読み込めませんでした。data/manifest.json を確認してください。</li>`;
      return;
    }

    const sets = manifest.sets || [];
    if (!sets.length) {
      els.questionList.innerHTML = `<li class="empty-state">問題セットがまだ登録されていません。</li>`;
      return;
    }

    const activeId = setId && sets.some((s) => s.id === setId) ? setId : sets[0].id;
    const setMeta = sets.find((s) => s.id === activeId);

    buildNav(manifest, activeId);

    let setData;
    try {
      setData = await fetchJSON(DATA_DIR + setMeta.file);
    } catch (e) {
      els.questionList.innerHTML = `<li class="empty-state">${escapeHTML(setMeta.file)} を読み込めませんでした。</li>`;
      return;
    }

    els.setTitle.textContent = setData.title || setMeta.title || activeId;
    document.title = (setData.title || activeId) + " | 学習クイズ";

    const allProgress = loadProgress();
    const setProgress = getSetProgress(allProgress, activeId);

    els.questionList.innerHTML = "";
    const cards = [];
    setData.questions.forEach((q) => {
      const savedState = setProgress[q.id] || {};
      const card = renderQuestion(q, savedState);
      els.questionList.appendChild(card);
      cards.push({ card, q });
      updateResultLabel(card, q, !!savedState.revealed);
      if (savedState.revealed) markWrongSelections(card);
    });

    function persist(qid, patch) {
      const all = loadProgress();
      all[activeId] = all[activeId] || {};
      all[activeId][qid] = Object.assign({}, all[activeId][qid], patch);
      saveProgress(all);
      updateProgressSummary(all[activeId], setData.questions.length);
    }

    function updateProgressSummary(setProg, total) {
      setProg = setProg || {};
      const answered = Object.values(setProg).filter((s) => s.selected && s.selected.length).length;
      const revealedCount = Object.values(setProg).filter((s) => s.revealed).length;
      const correctCount = Object.values(setProg).filter((s) => s.revealed && s.correct).length;
      let text = `回答済み ${answered}/${total}`;
      if (revealedCount > 0) text += `　正解 ${correctCount}/${revealedCount}(採点済み中)`;
      els.progressSummary.textContent = text;
    }

    updateProgressSummary(setProgress, setData.questions.length);

    // ---------- イベントハンドラ ----------
    cards.forEach(({ card, q }) => {
      card.addEventListener("change", (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const selected = currentSelection(card);
        const revealed = card.classList.contains("revealed");
        updateResultLabel(card, q, revealed);
        if (revealed) markWrongSelections(card);
        persist(q.id, {
          selected,
          revealed,
          correct: isCorrectSelection(selected, q.correct),
        });
      });

      card.querySelector(".reveal-btn").addEventListener("click", () => {
        const nowRevealed = !card.classList.contains("revealed");
        card.classList.toggle("revealed", nowRevealed);
        card.querySelector(".reveal-btn").textContent = nowRevealed ? "解答を隠す" : "解答を表示";
        const selected = currentSelection(card);
        updateResultLabel(card, q, nowRevealed);
        if (nowRevealed) markWrongSelections(card);
        persist(q.id, {
          selected,
          revealed: nowRevealed,
          correct: isCorrectSelection(selected, q.correct),
        });
      });
    });

    els.toggleAllBtn.addEventListener("click", () => {
      const anyHidden = cards.some(({ card }) => !card.classList.contains("revealed"));
      cards.forEach(({ card, q }) => {
        card.classList.toggle("revealed", anyHidden);
        card.querySelector(".reveal-btn").textContent = anyHidden ? "解答を隠す" : "解答を表示";
        const selected = currentSelection(card);
        updateResultLabel(card, q, anyHidden);
        if (anyHidden) markWrongSelections(card);
        persist(q.id, {
          selected,
          revealed: anyHidden,
          correct: isCorrectSelection(selected, q.correct),
        });
      });
      els.toggleAllBtn.textContent = anyHidden ? "すべての解答を隠す" : "すべての解答を表示";
    });

    els.resetBtn.addEventListener("click", () => {
      if (!confirm("このセットの回答・進捗をリセットします。よろしいですか?")) return;
      const all = loadProgress();
      delete all[activeId];
      saveProgress(all);
      location.reload();
    });

    els.pagerBottom.innerHTML = `
      ${els.prevLink.hasAttribute("aria-disabled") ? "" : `<a class="btn btn-small btn-outline" href="${els.prevLink.getAttribute("href")}">← 前のセット</a>`}
      <span class="set-pill">${escapeHTML(activeId)}</span>
      ${els.nextLink.hasAttribute("aria-disabled") ? "" : `<a class="btn btn-small btn-outline" href="${els.nextLink.getAttribute("href")}">次のセット →</a>`}
    `;
  }

  main();
})();
