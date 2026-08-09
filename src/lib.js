'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config.json'),
  snapshots: path.join(ROOT, 'snapshots'),
  reports: path.join(ROOT, 'reports'),
};

function loadConfig() {
  const raw = fs.readFileSync(PATHS.config, 'utf8');
  const cfg = JSON.parse(raw);
  if (!Array.isArray(cfg.topics) || cfg.topics.length === 0) {
    throw new Error('config.json の topics が空です。');
  }
  return cfg;
}

/** 2026-08-09 形式の日付文字列（ローカル時刻基準） */
function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** snapshots/*.json を古い順に並べて返す */
function listSnapshots() {
  if (!fs.existsSync(PATHS.snapshots)) return [];
  return fs
    .readdirSync(PATHS.snapshots)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => ({
      date: f.replace(/\.json$/, ''),
      file: path.join(PATHS.snapshots, f),
    }));
}

function readSnapshot(entry) {
  return JSON.parse(fs.readFileSync(entry.file, 'utf8'));
}

function daysBetween(fromDateStr, toDateStr) {
  const a = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const b = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 各サービスに名乗る User-Agent。Reddit のように書式を要求するサービスがあるため統一する。 */
const USER_AGENT = 'nodejs:ai-agent-ranking:v1.0 (github.com/iphonekamatsu-ux/ai-agent-ranking)';

/**
 * 共通の HTTP 取得。一時的な失敗は少し待って再試行する。
 * 恒久的な失敗（404 など）は即座に例外にする。
 */
async function httpGet(url, { headers = {}, retries = 2, asText = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
      if (res.ok) return asText ? res.text() : res.json();

      // 混雑・レート制限は再試行の価値がある
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      lastError = err;
      // 証明書エラーは再試行しても直らないので即座に諦める
      if (err.cause && err.cause.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') {
        throw new Error(
          '証明書エラー。ローカル実行時は NODE_OPTIONS=--use-system-ca が必要です（run.bat は設定済み）。'
        );
      }
    }
    if (attempt < retries) await sleep(2000 * (attempt + 1));
  }
  throw lastError || new Error('取得に失敗しました');
}

/** XML の 1 要素を取り出す（外部ライブラリを使わないための簡易処理） */
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  PATHS,
  loadConfig,
  dateKey,
  ensureDir,
  listSnapshots,
  readSnapshot,
  daysBetween,
  sleep,
  httpGet,
  xmlTag,
  USER_AGENT,
};
