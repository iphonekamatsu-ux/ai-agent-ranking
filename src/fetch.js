'use strict';

/**
 * GitHub 検索 API から AI エージェント関連リポジトリを取得し、
 * snapshots/YYYY-MM-DD.json として保存する。
 *
 * 認証トークンは任意。GITHUB_TOKEN 環境変数があれば使う（レート制限が 10/分 → 30/分 に緩む）。
 */

const fs = require('fs');
const path = require('path');
const { PATHS, loadConfig, dateKey, ensureDir, sleep } = require('./lib');

const TOKEN = process.env.GITHUB_TOKEN || '';
// 検索 API のレート制限は未認証 10回/分、認証済み 30回/分。安全側に倒した待ち時間。
const WAIT_MS = TOKEN ? 2500 : 7000;

function headers() {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'toolgit-ai-agent-ranking',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function searchRepositories(query, perPage) {
  const url =
    'https://api.github.com/search/repositories' +
    `?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: headers() });

    if (res.ok) return res.json();

    // レート制限に当たった場合は待って再試行する
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const waitMs = reset > Date.now() ? reset - Date.now() + 2000 : attempt * 15000;
      console.log(`  レート制限に到達。${Math.ceil(waitMs / 1000)} 秒待機して再試行します (${attempt}/4)`);
      await sleep(waitMs);
      continue;
    }

    const body = await res.text();
    throw new Error(`GitHub API エラー ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error('レート制限の解除を待ちましたが取得できませんでした。時間をおいて再実行してください。');
}

function toRepoRecord(item, matchedTopic) {
  return {
    id: item.id,
    fullName: item.full_name,
    url: item.html_url,
    description: item.description || '',
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language || '',
    topics: item.topics || [],
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    archived: !!item.archived,
    matchedTopics: [matchedTopic],
  };
}

async function main() {
  const cfg = loadConfig();
  const excluded = new Set((cfg.exclude?.repos || []).map((s) => s.toLowerCase()));
  const perPage = Math.min(cfg.perPage || 100, 100);

  console.log(`取得開始 (${cfg.topics.length} トピック / 認証: ${TOKEN ? 'あり' : 'なし'})`);

  /** @type {Map<number, ReturnType<typeof toRepoRecord>>} */
  const repos = new Map();
  let skipped = 0;

  for (let i = 0; i < cfg.topics.length; i++) {
    const { topic, minStars } = cfg.topics[i];
    const query = `topic:${topic} stars:>=${minStars ?? 0}`;

    const json = await searchRepositories(query, perPage);
    const items = json.items || [];
    console.log(`  [${i + 1}/${cfg.topics.length}] ${topic} … ${items.length} 件取得 (該当合計 ${json.total_count} 件)`);

    for (const item of items) {
      if (excluded.has(item.full_name.toLowerCase())) {
        skipped++;
        continue;
      }
      const existing = repos.get(item.id);
      if (existing) {
        // 複数トピックに該当した場合はどのトピックで拾ったかを記録しておく
        if (!existing.matchedTopics.includes(topic)) existing.matchedTopics.push(topic);
      } else {
        repos.set(item.id, toRepoRecord(item, topic));
      }
    }

    if (i < cfg.topics.length - 1) await sleep(WAIT_MS);
  }

  const list = [...repos.values()].sort((a, b) => b.stars - a.stars);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    topics: cfg.topics,
    repoCount: list.length,
    repos: list,
  };

  ensureDir(PATHS.snapshots);
  const outFile = path.join(PATHS.snapshots, `${dateKey()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log(`\n完了: ${list.length} リポジトリ（重複除外後）／除外リスト該当 ${skipped} 件`);
  console.log(`保存先: ${path.relative(PATHS.root, outFile)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nエラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
