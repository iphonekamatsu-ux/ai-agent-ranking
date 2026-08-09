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

module.exports = { PATHS, loadConfig, dateKey, ensureDir, listSnapshots, readSnapshot, daysBetween, sleep };
