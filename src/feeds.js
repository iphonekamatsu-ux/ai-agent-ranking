'use strict';

/**
 * GitHub 以外の情報源をまとめて取得する。
 * 1 つの情報源が失敗しても他は続行する（仕様変更や一時的な障害で全体を止めないため）。
 */

const SOURCES = [
  require('./sources/hackernews'),
  require('./sources/huggingface'),
  require('./sources/arxiv'),
  require('./sources/zenn'),
  require('./sources/qiita'),
  require('./sources/reddit'),
];

async function collectAll(cfg) {
  const sourcesCfg = cfg.sources || {};
  const aiPattern = cfg.aiPattern ? new RegExp(cfg.aiPattern, 'i') : null;

  const allItems = [];
  const status = [];

  for (const source of SOURCES) {
    const sourceCfg = sourcesCfg[source.KEY] || {};
    if (sourceCfg.enabled === false) {
      status.push({ key: source.KEY, label: source.LABEL, state: 'disabled', count: 0, note: '設定で無効' });
      console.log(`  - ${source.LABEL}: 無効（設定でスキップ）`);
      continue;
    }

    try {
      const { items, note, skipped } = await source.collect(sourceCfg, aiPattern);
      allItems.push(...items);
      status.push({
        key: source.KEY,
        label: source.LABEL,
        state: skipped ? 'skipped' : 'ok',
        count: items.length,
        note: note || '',
      });
      const suffix = note ? `（${note}）` : '';
      console.log(`  ${skipped ? '-' : '✓'} ${source.LABEL}: ${items.length} 件${suffix}`);
    } catch (err) {
      status.push({ key: source.KEY, label: source.LABEL, state: 'error', count: 0, note: err.message });
      console.log(`  ✗ ${source.LABEL}: 取得失敗 — ${err.message}`);
    }
  }

  return { items: allItems, status };
}

module.exports = { collectAll, SOURCES };
