'use strict';

/**
 * snapshots/ に貯まったデータからランキングレポート（Markdown）を生成する。
 *
 *  1. 累計 star ランキング      … スナップショット 1 回分から作れる
 *  2. 新顔ランキング（期間別）  … スナップショット 1 回分から作れる（作成日ベース）
 *  3. 伸びランキング（期間別）  … 過去のスナップショットとの差分。期間分の蓄積が必要
 */

const fs = require('fs');
const path = require('path');
const { PATHS, loadConfig, dateKey, ensureDir, listSnapshots, readSnapshot, daysBetween } = require('./lib');

/** Markdown の表を壊さないよう整形する */
function cell(text, maxLen = 70) {
  const s = String(text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '¦').trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

function num(n) {
  return Number(n).toLocaleString('en-US');
}

function periodLabel(days) {
  if (days % 365 === 0) return `直近${days / 365}年`;
  if (days % 30 === 0) return `直近${days / 30}ヶ月`;
  if (days % 7 === 0) return `直近${days / 7}週間`;
  return `直近${days}日`;
}

/**
 * 指定期間の比較対象となる過去スナップショットを選ぶ。
 * 期間の 80% 以上の古さがあるものの中から、狙った日数に最も近いものを採用する。
 */
function pickBaseline(snapshots, latestDate, periodDays) {
  const minAge = Math.max(1, Math.round(periodDays * 0.8));
  const candidates = snapshots
    .filter((s) => s.date !== latestDate)
    .map((s) => ({ ...s, age: daysBetween(s.date, latestDate) }))
    .filter((s) => s.age >= minAge);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.age - periodDays) - Math.abs(b.age - periodDays));
  return candidates[0];
}

function buildGrowthSection(snapshots, latest, latestDate, periodDays, topN) {
  const label = periodLabel(periodDays);
  const baseline = pickBaseline(snapshots, latestDate, periodDays);

  if (!baseline) {
    const oldest = snapshots[0];
    const have = oldest && oldest.date !== latestDate ? daysBetween(oldest.date, latestDate) : 0;
    const need = Math.max(1, Math.round(periodDays * 0.8)) - have;
    return [
      `### ${label}の star 増加ランキング`,
      '',
      `> ⏳ **データ蓄積中** — このランキングにはあと **約 ${need} 日** 分の記録が必要です。`,
      `> （現在の蓄積: ${have} 日分 / 必要: 約 ${Math.max(1, Math.round(periodDays * 0.8))} 日分）`,
      '',
    ].join('\n');
  }

  const past = new Map(readSnapshot(baseline).repos.map((r) => [r.fullName, r]));
  const rows = [];

  for (const repo of latest.repos) {
    const before = past.get(repo.fullName);
    if (!before) continue; // 前回時点で対象外だったものは伸びを計算できない
    const delta = repo.stars - before.stars;
    if (delta <= 0) continue;
    rows.push({
      ...repo,
      delta,
      rate: before.stars > 0 ? (delta / before.stars) * 100 : 0,
    });
  }

  rows.sort((a, b) => b.delta - a.delta);

  const lines = [
    `### ${label}の star 増加ランキング`,
    '',
    `比較対象: \`${baseline.date}\` の記録（実際の間隔 ${baseline.age} 日）`,
    '',
    '| # | リポジトリ | 増加 | 増加率 | 現在の★ | 説明 |',
    '|---:|---|---:|---:|---:|---|',
  ];

  rows.slice(0, topN).forEach((r, i) => {
    lines.push(
      `| ${i + 1} | [${cell(r.fullName, 40)}](${r.url}) | **+${num(r.delta)}** | ${r.rate.toFixed(1)}% | ${num(r.stars)} | ${cell(r.description)} |`
    );
  });

  if (rows.length === 0) lines.push('| — | 増加したリポジトリがありませんでした | | | | |');
  lines.push('');
  return lines.join('\n');
}

function buildNewcomerSection(latest, fetchedAt, periodDays, topN) {
  const label = periodLabel(periodDays);
  const since = new Date(fetchedAt.getTime() - periodDays * 86400000);

  const rows = latest.repos
    .filter((r) => new Date(r.createdAt) >= since)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, topN);

  const lines = [
    `### ${label}に登場した新顔ランキング`,
    '',
    '| # | リポジトリ | ★ | 作成日 | 言語 | 説明 |',
    '|---:|---|---:|---|---|---|',
  ];

  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | [${cell(r.fullName, 40)}](${r.url}) | ${num(r.stars)} | ${r.createdAt.slice(0, 10)} | ${cell(r.language, 12)} | ${cell(r.description)} |`
    );
  });

  if (rows.length === 0) lines.push('| — | 該当なし | | | | |');
  lines.push('');
  return lines.join('\n');
}

/** 記事1行分の表の行を作る */
function itemRow(rank, item, extraCol) {
  const link = `[${cell(item.title, 66)}](${item.url})`;
  const score = item.scoreUnit ? `${num(item.score)}${item.scoreUnit}` : '—';
  const date = item.createdAt ? item.createdAt.slice(0, 10) : '—';
  return `| ${rank} | ${link} | ${score} | ${extraCol ?? date} |`;
}

/**
 * 情報源ごとの章を作る。
 * 同じ記事が毎週並ぶのを避けるため「新着」「伸び」「総合」に分けている。
 */
function buildFeedSections(latest, prevEntry, cfg) {
  const { SOURCES } = require('./feeds');
  const topN = cfg.report?.feedTopN || 15;
  const items = latest.items || [];
  if (items.length === 0) return '';

  const prev = prevEntry
    ? new Map((readSnapshot(prevEntry).items || []).map((i) => [i.id, i]))
    : null;
  const statusByKey = new Map((latest.sourceStatus || []).map((s) => [s.key, s]));

  const out = ['## 4. GitHub 以外の情報源', ''];
  if (!prev) {
    out.push('> 初回のため、すべて新着として扱っています。次回から「新着」「伸び」が区別されます。', '');
  }

  for (const source of SOURCES) {
    const list = items.filter((i) => i.source === source.KEY);
    const status = statusByKey.get(source.KEY);

    out.push(`### ${source.LABEL}`, '');

    if (list.length === 0) {
      const reason = status?.note || '取得できませんでした';
      out.push(`> ${status?.state === 'skipped' ? '⏭️' : '⚠️'} ${reason}`, '');
      continue;
    }

    const hasScore = list.some((i) => i.scoreUnit);

    // --- 新着（前回の記録に無かったもの） ---
    const fresh = prev ? list.filter((i) => !prev.has(i.id)) : list;
    const freshSorted = hasScore
      ? [...fresh].sort((a, b) => b.score - a.score)
      : [...fresh].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    out.push(`**🆕 新着 ${freshSorted.length} 件**`, '');
    if (freshSorted.length === 0) {
      out.push('前回から新しいものはありませんでした。', '');
    } else {
      out.push('| # | タイトル | スコア | 日付 |', '|---:|---|---:|---|');
      freshSorted.slice(0, topN).forEach((it, i) => out.push(itemRow(i + 1, it)));
      out.push('');
    }

    // --- 伸び（前回よりスコアが上がったもの） ---
    if (prev && hasScore) {
      const risen = list
        .map((i) => {
          const before = prev.get(i.id);
          return before ? { ...i, delta: i.score - before.score } : null;
        })
        .filter((i) => i && i.delta > 0)
        .sort((a, b) => b.delta - a.delta);

      if (risen.length > 0) {
        out.push(`**📈 前回から伸びたもの ${risen.length} 件**`, '');
        out.push('| # | タイトル | 現在 | 増加 |', '|---:|---|---:|---:|');
        risen
          .slice(0, topN)
          .forEach((it, i) => out.push(itemRow(i + 1, it, `**+${num(it.delta)}**`)));
        out.push('');
      }
    }

    // --- 総合トップ（既出も含む） ---
    if (hasScore) {
      const top = [...list].sort((a, b) => b.score - a.score).slice(0, topN);
      out.push(`**総合トップ ${top.length} 件**（前回も掲載されたものには 🔁 が付きます）`, '');
      out.push('| # | タイトル | スコア | 状態 |', '|---:|---|---:|---|');
      top.forEach((it, i) => {
        const mark = prev && prev.has(it.id) ? '🔁 既出' : '🆕 新着';
        out.push(itemRow(i + 1, it, mark));
      });
      out.push('');
    }
  }

  return out.join('\n');
}

function buildTotalSection(latest, topN) {
  const rows = [...latest.repos].sort((a, b) => b.stars - a.stars).slice(0, topN);
  const lines = [
    `## 1. 累計 star ランキング TOP ${topN}`,
    '',
    '| # | リポジトリ | ★ | 言語 | 最終更新 | 説明 |',
    '|---:|---|---:|---|---|---|',
  ];
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | [${cell(r.fullName, 40)}](${r.url}) | ${num(r.stars)} | ${cell(r.language, 12)} | ${r.pushedAt.slice(0, 10)} | ${cell(r.description)} |`
    );
  });
  lines.push('');
  return lines.join('\n');
}

function main() {
  const cfg = loadConfig();
  const topN = cfg.report?.topN || 30;
  const snapshots = listSnapshots();

  if (snapshots.length === 0) {
    console.error('スナップショットがありません。先に `npm run fetch` を実行してください。');
    process.exit(1);
  }

  const latestEntry = snapshots[snapshots.length - 1];
  const latest = readSnapshot(latestEntry);
  const fetchedAt = new Date(latest.fetchedAt);

  // 除外リストはレポート時にも適用する。過去のスナップショットを取り直さなくても
  // config.json に追記するだけで即座に効かせられるようにするため。
  const excluded = new Set((cfg.exclude?.repos || []).map((s) => s.toLowerCase()));
  const before = latest.repos.length;
  latest.repos = latest.repos.filter((r) => !excluded.has(r.fullName.toLowerCase()));
  latest.repoCount = latest.repos.length;
  const removed = before - latest.repos.length;

  const md = [];
  md.push('# AI エージェント関連 GitHub リポジトリ ランキング');
  md.push('');
  md.push(`取得日時: **${latest.fetchedAt.replace('T', ' ').slice(0, 16)} UTC**　/　対象: **${num(latest.repoCount)} リポジトリ**　/　記録回数: **${snapshots.length} 回**${removed ? `　/　除外: ${removed} 件` : ''}`);
  md.push('');
  md.push(`対象トピック: ${cfg.topics.map((t) => `\`${t.topic}\``).join(', ')}`);
  md.push('');
  md.push('---');
  md.push('');

  md.push(buildTotalSection(latest, topN));
  md.push('---');
  md.push('');

  md.push('## 2. 新顔ランキング（作成日ベース）');
  md.push('');
  md.push('その期間に**新しく作られた**リポジトリのランキングです。初回実行から利用できます。');
  md.push('');
  for (const days of cfg.report?.newcomerPeriods || [7, 30, 90, 180, 365]) {
    md.push(buildNewcomerSection(latest, fetchedAt, days, topN));
  }
  md.push('---');
  md.push('');

  md.push('## 3. 伸びランキング（star 増加ベース）');
  md.push('');
  md.push('過去の記録との差分です。**期間分の記録が貯まると自動で表示されます。**');
  md.push('');
  for (const days of cfg.report?.growthPeriods || [7, 30, 90, 180, 365]) {
    md.push(buildGrowthSection(snapshots, latest, latestEntry.date, days, topN));
  }

  const feedSections = buildFeedSections(latest, snapshots[snapshots.length - 2] || null, cfg);
  if (feedSections) {
    md.push('---');
    md.push('');
    md.push(feedSections);
  }

  const out = md.join('\n');

  ensureDir(PATHS.reports);
  const dated = path.join(PATHS.reports, `${dateKey(fetchedAt)}.md`);
  const latestFile = path.join(PATHS.reports, 'latest.md');
  fs.writeFileSync(dated, out, 'utf8');
  fs.writeFileSync(latestFile, out, 'utf8');

  console.log(`レポート生成完了: ${path.relative(PATHS.root, latestFile)}`);
  console.log(`　　　　　　　　  ${path.relative(PATHS.root, dated)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\nエラー: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main };
