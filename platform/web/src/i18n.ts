import { useSyncExternalStore } from 'react';
import { EN_PATTERNS, EN_TEXT } from './i18n-en';

/**
 * Chuyển ngôn ngữ Tiếng Việt / English cho giao diện người dân.
 * Mã nguồn vẫn viết câu tiếng Việt; khi chọn English, lớp này dịch chữ đang hiện trên màn hình (chữ, placeholder,
 * aria-label, title, alt) theo bảng trong i18n-en.ts và tự dịch lại mỗi khi giao diện cập nhật.
 * Câu không có trong bảng (tên địa danh, nội dung do cán bộ viết, lỗi từ máy chủ) giữ nguyên tiếng Việt.
 * Nội dung người dùng gõ (ô nhập) không bao giờ bị đổi. Đánh dấu data-no-translate để loại một vùng.
 */
export type Lang = 'vi' | 'en';

const STORAGE_KEY = 'cskv.lang';
const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'] as const;
/** Không dịch cả vùng (kể cả thuộc tính). */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
/** Không dịch chữ bên trong (nội dung người dùng gõ, mã hồ sơ), vẫn dịch placeholder/aria-label. */
const TEXT_SKIP_TAGS = new Set(['TEXTAREA', 'CODE', 'PRE']);
const LANG_EVENT = 'cskv:lang';

type Compiled = { re: RegExp; order: number[]; en: string; weight: number };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compiledPatterns: Compiled[] = EN_PATTERNS.map(([vi, en]) => {
  // {0} khớp mọi chữ; {0#} chỉ khớp số (ví dụ "{0#} người" không đụng câu thường kết thúc bằng "người").
  const parts = vi.split(/\{(\d+#?)\}/);
  let source = '^';
  const order: number[] = [];
  let weight = 0;
  parts.forEach((part, index) => {
    if (index % 2 === 0) { source += escapeRegExp(part); weight += part.length; }
    else { source += part.endsWith('#') ? '([\\d.,\\s]+)' : '(.*?)'; order.push(Number.parseInt(part, 10)); }
  });
  return { re: new RegExp(`${source}$`, 's'), order, en, weight };
}).sort((a, b) => b.weight - a.weight);

/** Dịch một câu tiếng Việt sang tiếng Anh; null nếu không có trong bảng. */
export function translateText(text: string, depth = 0): string | null {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key) return null;
  const direct = EN_TEXT[key];
  if (direct !== undefined) return direct;
  if (depth > 2) return null;
  for (const pattern of compiledPatterns) {
    const match = pattern.re.exec(key);
    if (!match) continue;
    const values: string[] = [];
    pattern.order.forEach((slot, index) => { values[slot] = match[index + 1] ?? ''; });
    return pattern.en.replace(/\{(\d+)\}/g, (_, slot: string) => {
      const value = values[Number(slot)] ?? '';
      return translateText(value, depth + 1) ?? value;
    });
  }
  return null;
}

function readStoredLang(): Lang {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; }
}

let currentLang: Lang = 'vi';
type Record_ = { original: string; shown: string };
const textRecords = new Map<Text, Record_>();
const attributeRecords = new Map<Element, Map<string, Record_>>();
let observer: MutationObserver | null = null;
let originalTitle = '';
let writesSincePrune = 0;

function isSkipped(node: Node): boolean {
  const isText = node.nodeType === Node.TEXT_NODE;
  const element = isText ? node.parentElement : node as Element;
  if (!element) return true;
  if (SKIP_TAGS.has(element.tagName) || (isText && TEXT_SKIP_TAGS.has(element.tagName))) return true;
  return Boolean(element.closest('[data-no-translate], [contenteditable="true"]'));
}

function prune() {
  writesSincePrune += 1;
  if (writesSincePrune < 400) return;
  writesSincePrune = 0;
  for (const node of textRecords.keys()) if (!node.isConnected) textRecords.delete(node);
  for (const element of attributeRecords.keys()) if (!element.isConnected) attributeRecords.delete(element);
}

function applyText(node: Text) {
  const value = node.nodeValue ?? '';
  const record = textRecords.get(node);
  if (record && value === record.shown) return;
  const translated = currentLang === 'en' ? translateText(value) : null;
  if (translated === null) { if (record) textRecords.delete(node); return; }
  const spacing = /^(\s*)[\s\S]*?(\s*)$/.exec(value);
  const shown = `${spacing?.[1] ?? ''}${translated}${spacing?.[2] ?? ''}`;
  textRecords.set(node, { original: value, shown });
  prune();
  if (shown !== value) node.nodeValue = shown;
}

function applyAttribute(element: Element, name: string) {
  const value = element.getAttribute(name);
  if (value === null) return;
  let records = attributeRecords.get(element);
  const record = records?.get(name);
  if (record && value === record.shown) return;
  const translated = currentLang === 'en' ? translateText(value) : null;
  if (translated === null) { records?.delete(name); return; }
  if (!records) { records = new Map(); attributeRecords.set(element, records); }
  records.set(name, { original: value, shown: translated });
  prune();
  if (translated !== value) element.setAttribute(name, translated);
}

function applyElementAttributes(element: Element) {
  for (const name of ATTRIBUTES) if (element.hasAttribute(name)) applyAttribute(element, name);
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { if (!isSkipped(root)) applyText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || isSkipped(root)) return;
  applyElementAttributes(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (SKIP_TAGS.has(element.tagName) || element.hasAttribute('data-no-translate')) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) { if (!TEXT_SKIP_TAGS.has(node.parentElement?.tagName ?? '')) applyText(node as Text); }
    else applyElementAttributes(node as Element);
  }
}

function restoreVietnamese() {
  for (const [node, record] of textRecords) if (node.isConnected && node.nodeValue === record.shown) node.nodeValue = record.original;
  for (const [element, records] of attributeRecords) {
    if (!element.isConnected) continue;
    for (const [name, record] of records) if (element.getAttribute(name) === record.shown) element.setAttribute(name, record.original);
  }
  textRecords.clear();
  attributeRecords.clear();
}

function syncDocument() {
  document.documentElement.lang = currentLang;
  document.title = currentLang === 'en' ? (translateText(originalTitle) ?? originalTitle) : originalTitle;
}

/** Gọi một lần trước khi dựng giao diện. */
export function initI18n() {
  if (typeof document === 'undefined' || observer) return;
  originalTitle = document.title;
  currentLang = readStoredLang();
  syncDocument();
  observer = new MutationObserver((mutations) => {
    if (currentLang === 'vi') return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') { if (!isSkipped(mutation.target)) applyText(mutation.target as Text); }
      else if (mutation.type === 'attributes') { if (mutation.attributeName && !isSkipped(mutation.target)) applyAttribute(mutation.target as Element, mutation.attributeName); }
      else mutation.addedNodes.forEach(translateTree);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  if (currentLang === 'en' && document.body) translateTree(document.body);
}

export function getLang(): Lang { return currentLang; }

export function setLang(next: Lang) {
  if (next === currentLang) return;
  currentLang = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* chế độ riêng tư: chỉ đổi trong phiên này */ }
  if (next === 'vi') restoreVietnamese(); else if (document.body) translateTree(document.body);
  syncDocument();
  window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: next }));
}

function subscribe(callback: () => void) {
  window.addEventListener(LANG_EVENT, callback);
  return () => window.removeEventListener(LANG_EVENT, callback);
}

/** Ngôn ngữ hiện tại cho component (tự cập nhật khi đổi). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'vi');
}
