'use strict';

/**
 * arXiv（公式 API・認証不要）
 * カテゴリ（cs.AI = 人工知能、cs.MA = マルチエージェント等）で絞るため精度は高い。
 * 論文には「いいね数」に相当する指標がないので、新着順に並べる。
 *
 * arXiv は連続アクセスに 3 秒以上の間隔を空けるよう案内しているため待機を入れている。
 */

const { httpGet, xmlTag, sleep } = require('../lib');

const KEY = 'arxiv';
const LABEL = 'arXiv（論文）';

async function collect(sourceCfg) {
  const categories = sourceCfg.categories || ['cs.AI'];
  const limit = sourceCfg.limit ?? 30;
  const lookbackDays = sourceCfg.lookbackDays ?? 8;
  const since = Date.now() - lookbackDays * 86400000;

  const query = categories.map((c) => `cat:${c}`).join('+OR+');
  const url =
    'https://export.arxiv.org/api/query' +
    `?search_query=${query}` +
    `&start=0&max_results=${limit * 2}` +
    '&sortBy=submittedDate&sortOrder=descending';

  const xml = await httpGet(url, { asText: true });
  await sleep(3000);

  const entries = xml.split('<entry>').slice(1);
  const items = [];

  for (const raw of entries) {
    const absUrl = xmlTag(raw, 'id');
    const published = xmlTag(raw, 'published');
    if (!absUrl || !published) continue;
    if (new Date(published).getTime() < since) continue;

    const authors = (raw.match(/<name>([\s\S]*?)<\/name>/g) || [])
      .map((m) => m.replace(/<\/?name>/g, '').trim())
      .slice(0, 3);

    items.push({
      id: `arxiv:${absUrl.split('/abs/')[1] || absUrl}`,
      source: KEY,
      title: xmlTag(raw, 'title'),
      url: absUrl,
      score: 0,
      scoreUnit: '',
      createdAt: published,
      authors: authors.join(', '),
      summary: xmlTag(raw, 'summary').slice(0, 160),
    });

    if (items.length >= limit) break;
  }

  return { items, note: `カテゴリ: ${categories.join(', ')}` };
}

module.exports = { KEY, LABEL, collect };
