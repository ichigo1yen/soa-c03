#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_htm_to_json.py

exam-topics 形式の .htm ファイル(複数可)を読み込み、学習用クイズサイトが読み込む
JSON ファイル群 (1ファイルにつき最大 CHUNK_SIZE 問) に変換する。
同時に data/manifest.json を更新(再生成)する。

使い方:
    python3 convert_htm_to_json.py <入力.htmを含むフォルダ or ファイルを複数指定> \
        --out-dir ../data --chunk-size 20 --title-prefix "AWS 認定機械学習 MLS-C01"

例:
    # sources/ フォルダに 101-110.htm, 111-120.htm ... を入れておく場合
    python3 convert_htm_to_json.py sources/*.htm --out-dir ../data --chunk-size 20

入力側の前提 (exam-topics 系サイトでよくある構造):
    <div class="question-body" data-id="...">
        <b>質問#101 </b>
        <p class="card-text"> 本文 ... </p>
        ...
        <div class="question-choices-container">
            <ul>
                <li class="multi-choice-item correct-hidden">
                    <span class="multi-choice-letter" data-choice-letter="A">A. </span> 選択肢テキスト
                </li>
                ...
            </ul>
        </div>
        ...
        <span class="correct-answer-box"><strong>Suggested Answer:</strong>
            <span class="correct-answer">A</span>
        </span>
    </div>

正解が複数文字 (例: "AC") の場合は複数選択問題として type="multiple" にする。
"""
import argparse
import glob
import json
import os
import re
import sys

from bs4 import BeautifulSoup


_CJK_RE = re.compile(r"[\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]")


def _is_cjk(ch: str) -> bool:
    return bool(ch) and bool(_CJK_RE.match(ch))


def _collapse_segment(seg: str) -> str:
    """1つの<br>区切り内の余分な空白・改行を畳み込む。
    日本語(CJK文字)同士の間の改行はソースの単純な折り返しであることが多いため
    空白を挿入せずに詰める。それ以外(英数字を含む場合など)は半角スペース1つに畳む。
    """
    seg = seg.replace("\xa0", " ")

    def repl(m: "re.Match") -> str:
        start, end = m.span()
        before = seg[start - 1] if start > 0 else ""
        after = seg[end] if end < len(seg) else ""
        if _is_cjk(before) and _is_cjk(after):
            return ""
        return " "

    seg = re.sub(r"\s+", repl, seg)
    return seg.strip()


def clean_text(text: str) -> str:
    """余分な空白・改行を畳み込む(単純な折り返し改行は削除、それ以外は1スペースに)"""
    return _collapse_segment(text)


def clean_multiline_text(element) -> str:
    """<br>を明示的な改行として保持しつつ、それ以外の折り返し改行は畳み込む"""
    BR_TOKEN = "\u0001BR\u0001"
    html_copy = BeautifulSoup(str(element), "html.parser")
    for br in html_copy.find_all("br"):
        br.replace_with(BR_TOKEN)
    raw = html_copy.get_text()
    segments = raw.split(BR_TOKEN)
    cleaned = [_collapse_segment(seg) for seg in segments]
    # 空行は削除しつつ改行で連結
    return "\n".join(s for s in cleaned if s)


def parse_htm_file(path: str):
    """1つの .htm ファイルから問題のリストを抽出する"""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    questions = []
    for qbody in soup.select("div.question-body"):
        # 質問番号
        b_tag = qbody.find("b")
        if not b_tag:
            continue
        m = re.search(r"(\d+)", b_tag.get_text())
        if not m:
            continue
        qid = m.group(1)

        # 本文
        p_tag = qbody.find("p", class_="card-text")
        if not p_tag:
            continue
        qtext = clean_multiline_text(p_tag)

        # 選択肢
        choices = []
        correct_letters_from_class = []
        for li in qbody.select("ul li.multi-choice-item"):
            letter_span = li.find("span", class_="multi-choice-letter")
            letter = None
            if letter_span and letter_span.get("data-choice-letter"):
                letter = letter_span["data-choice-letter"].strip()

            # 正解の選択肢は <li class="multi-choice-item correct-hidden"> のように
            # correct-hidden クラスが付与される (新形式で採用されているマーキング方法)
            li_classes = li.get("class", [])
            if letter and "correct-hidden" in li_classes:
                correct_letters_from_class.append(letter.upper())

            # バッジ要素(「最も投票された」「This answer is currently...」等)は
            # 選択肢本文に含めないよう、テキスト抽出前に取り除く
            li_copy = BeautifulSoup(str(li), "html.parser")
            for badge in li_copy.select(".badge, .most-voted-answer-badge"):
                badge.decompose()

            full_text = clean_multiline_text(li_copy)
            if letter and full_text.startswith(letter + "."):
                full_text = full_text[len(letter) + 1:].strip()
            full_text = re.sub(r"\s*This answer is currently.*$", "", full_text).strip()
            if letter:
                choices.append({"letter": letter, "text": full_text})

        if not choices:
            continue

        # 正解の判定は複数の情報源を順に試す (サイトのHTML構造がバージョンにより異なるため):
        #   1. 旧形式: <span class="correct-answer">A</span> (Suggested Answer ボックス)
        #   2. 新形式: 正解の <li> に付与される class="correct-hidden"
        #   3. 新形式のフォールバック: <script type="application/json"> 内の voted_answers
        correct_letters = []

        correct_span = qbody.find("span", class_="correct-answer")
        if correct_span:
            raw = correct_span.get_text()
            correct_letters = sorted(set(c.upper() for c in re.findall(r"[A-Za-z]", raw)))

        if not correct_letters and correct_letters_from_class:
            correct_letters = sorted(set(correct_letters_from_class))

        if not correct_letters:
            for script_tag in qbody.find_all("script", attrs={"type": "application/json"}):
                try:
                    payload = json.loads(script_tag.get_text())
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(payload, dict):
                    payload = [payload]
                if not isinstance(payload, list):
                    continue
                letters = []
                for entry in payload:
                    if isinstance(entry, dict) and entry.get("voted_answers"):
                        letters.extend(re.findall(r"[A-Za-z]", str(entry["voted_answers"])))
                if letters:
                    correct_letters = sorted(set(c.upper() for c in letters))
                    break

        if not correct_letters:
            # 正解が取得できない問題はスキップ (手動確認用に警告)
            print(f"  [警告] 質問#{qid}: 正解を検出できませんでした ({path})", file=sys.stderr)
            continue

        qtype = "multiple" if len(correct_letters) > 1 else "single"

        questions.append({
            "id": qid,
            "text": qtext,
            "type": qtype,
            "choices": choices,
            "correct": correct_letters,
        })

    return questions


def chunk_list(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="入力の .htm ファイル (複数可、シェルのワイルドカード可)")
    ap.add_argument("--out-dir", default="../data", help="出力先フォルダ (デフォルト: ../data)")
    ap.add_argument("--chunk-size", type=int, default=20, help="1JSONファイルあたりの最大問題数 (デフォルト: 20)")
    ap.add_argument("--title-prefix", default="", help="manifest.json に載せるタイトルの接頭辞")
    ap.add_argument("--merge", action="store_true",
                     help="全入力ファイルの問題を1つにまとめてから chunk-size で分割する (指定しない場合、入力ファイルごとに独立して分割)")
    args = ap.parse_args()

    # ワイルドカードを展開 (Windows等でシェル展開されない場合に対応)
    input_files = []
    for pattern in args.inputs:
        matched = glob.glob(pattern)
        input_files.extend(matched if matched else [pattern])
    input_files = sorted(set(input_files))

    if not input_files:
        print("入力ファイルが見つかりませんでした。", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out_dir, exist_ok=True)

    all_questions = []
    for path in input_files:
        print(f"読み込み中: {path}")
        qs = parse_htm_file(path)
        print(f"  -> {len(qs)} 問を抽出")
        all_questions.extend(qs)

    if not all_questions:
        print("問題を1件も抽出できませんでした。HTML構造を確認してください。", file=sys.stderr)
        sys.exit(1)

    # 質問番号順にソート (数値として)
    all_questions.sort(key=lambda q: int(q["id"]))

    manifest_path = os.path.join(args.out_dir, "manifest.json")
    manifest = {"sets": []}
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            try:
                manifest = json.load(f)
            except json.JSONDecodeError:
                manifest = {"sets": []}

    existing_files = {s["file"] for s in manifest.get("sets", [])}

    new_sets = []
    for chunk in chunk_list(all_questions, args.chunk_size):
        first_id, last_id = chunk[0]["id"], chunk[-1]["id"]
        set_id = f"{first_id}-{last_id}"
        filename = f"{set_id}.json"
        out_path = os.path.join(args.out_dir, filename)

        title = f"{args.title_prefix} 問題 {first_id}-{last_id}".strip()
        payload = {
            "title": title,
            "questions": chunk,
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"書き出し: {out_path} ({len(chunk)} 問)")

        if filename not in existing_files:
            new_sets.append({
                "id": set_id,
                "file": filename,
                "title": title,
                "count": len(chunk),
            })

    manifest.setdefault("sets", [])
    manifest["sets"].extend(new_sets)
    # id順に並べ替え (先頭の数値で)
    manifest["sets"].sort(key=lambda s: int(re.search(r"\d+", s["id"]).group()))

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nmanifest.json を更新しました: {manifest_path} (合計 {len(manifest['sets'])} セット)")


if __name__ == "__main__":
    main()
