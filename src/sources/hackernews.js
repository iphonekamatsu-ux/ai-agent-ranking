'use strict';

/**
 * Hacker News（Algolia 検索 API・認証不要）
 *
 * 注意: 素朴にキーワード検索すると「GPT」が「PostgreSQL」に誤ヒットするなど
 * ノイズが大量に混じる。以下の 3 点で精度を確保している。
 *   1. typoTolerance=false            … あいまい検索を切る
 *   2. restrictSearchableAttributes   … 本文を見ず、タイトルと URL だけを対象にする
 *   3. advancedSyntax + 引用符        … フレーズの完全一致で検索する
 * さらに保険として、タイトルが AI 関連語を含むかを正規表現で最終確認する。
 */

const { httpGet, sleep } = require('../lib');

const KEY = 'hackernews';
const LABEL = 'Hacker News';

async function collect(sourceCfg, aiPattern) {
  const keywords = sourceCfg.keywords || [];
  const minPoints = sourceCfg.minPoints ?? 100;
  const lookbackDays = sourceCfg.lookbackDays ?? 8;
  const since = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  const items = new Map();
  let rejected = 0;

  for (const keyword of keywords) {
    const url =
      'https://hn.algolia.com/api/v1/search' +
      `?query=${encodeURIComponent(`"${keyword}"`)}` +
      '&tags=story' +
      `&numericFilters=${encodeURIComponent(`points>${minPoints},created_at_i>${since}`)}` +
      '&hitsPerPage=50' +
      '&restrictSearchableAttributes=title,url' +
      '&typoTolerance=false' +
      '&advancedSyntax=true';

    const json = await httpGet(url);
    for (const hit of json.hits || []) {
      if (items.has(hit.objectID)) continue;
      if (aiPattern && !aiPattern.test(hit.title || '')) {
        rejected++;
        continue;
      }
      items.set(hit.objectID, {
        id: `hn:${hit.objectID}`,
        source: KEY,
        title: hit.title || '(タイトルなし)',
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        score: hit.points || 0,
        scoreUnit: 'pt',
        comments: hit.num_comments || 0,
        createdAt: hit.created_at,
        matchedKeyword: keyword,
      });
    }
    await sleep(300);
  }

  return { items: [...items.values()], note: rejected ? `AI 関連語なしで除外 ${rejected} 件` : '' };
}

module.exports = { KEY, LABEL, collect };
