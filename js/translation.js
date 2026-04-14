// translation.js — MyMemory-backed translation with localStorage cache
// Free, no API key, 5000 chars/day, good Japanese support

import { Storage } from './storage.js';

// Simple heuristic: does the string contain CJK characters?
function containsCJK(text) {
  return /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
}

// MyMemory free endpoint — no key needed for reasonable usage
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

async function translateText(text, fromLang, toLang) {
  if (!text || !text.trim()) return null;
  if (fromLang === toLang) return { translatedText: text, transliteratedText: null };

  // Check cache first
  const cached = Storage.getCachedTranslation(text, toLang);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      q: text,
      langpair: `${fromLang}|${toLang}`,
    });
    const res = await fetch(`${MYMEMORY_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || 'Translation failed');
    }

    const result = {
      sourceText: text,
      sourceLanguage: fromLang,
      targetLanguage: toLang,
      translatedText: data.responseData.translatedText,
      transliteratedText: null, // MyMemory doesn't provide romaji
    };

    Storage.setCachedTranslation(text, toLang, result);
    return result;
  } catch (e) {
    console.warn('Translation failed for:', text, e);
    return null;
  }
}

// Translate a place name if it appears to be Japanese/CJK
async function translatePlaceName(name, targetLang = 'en') {
  if (!name) return null;
  if (!containsCJK(name)) return null;
  if (targetLang !== 'en') return null; // Only en for now

  return translateText(name, 'ja', 'en');
}

// Batch translate a list of names — rate limit friendly, sequential
async function batchTranslateNames(names, targetLang = 'en') {
  const results = {};
  for (const name of names) {
    if (containsCJK(name)) {
      const res = await translatePlaceName(name, targetLang);
      if (res) results[name] = res;
      // Small delay to be polite to the free API
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return results;
}

export const Translation = {
  containsCJK,
  translateText,
  translatePlaceName,
  batchTranslateNames,
};
