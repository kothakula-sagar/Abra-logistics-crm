/**
 * utils.js - Pure helper functions (no DOM, no Firebase)
 */

// ── STRING HELPERS ───────────────────────────────────────────
export function safeStr(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

export function escapeHtml(str) {
  return safeStr(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── SLUG ─────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','for','of','and','in','on','at','to','is','it','as',
  'or','by','with','from','this','that','was','are','be','been','has',
  'have','had','but','not','its','into','about','up','out','if','so',
  'we','our','your','their','there','which','will','can','all','more',
  'also','than','just','one','how','do','over','under','any','when','use','only','no'
]);

const CATEGORY_SYNONYMS = {
  jewellery: ['jewelry'],
  accessories: ['accessory', 'accessories'],
  clothing: ['apparel', 'clothes'],
  beauty: ['cosmetics', 'skincare', 'makeup'],
  kitchen: ['cookware', 'kitchen'],
  electronics: ['gadgets', 'electronics'],
  sports: ['fitness', 'athletic'],
  fitness: ['sports', 'workout'],
  books: ['books', 'stationery'],
  stationery: ['stationery', 'office'],
  toys: ['toys', 'kids', 'children'],
  grocery: ['grocery', 'groceries', 'food'],
  home: ['home', 'household']
};

function _normalizeText(text) {
  return safeStr(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateSlug(input) {
  return safeStr(input).toLowerCase()
    .replace(/[|&%@#*]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .join('-')
    .replace(/--+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 60);
}

export function validateSlug(slug) {
  const s = safeStr(slug);
  return [
    { label: 'All lowercase',                 pass: s === s.toLowerCase() },
    { label: 'No spaces',                     pass: !/\s/.test(s) },
    { label: 'No special chars',              pass: !/[|&%@#*]/.test(s) },
    { label: 'Under 60 characters',           pass: s.length <= 60 && s.length > 0 },
    { label: 'No double hyphens',             pass: !s.includes('--') },
    { label: 'No leading/trailing hyphens',   pass: !s.startsWith('-') && !s.endsWith('-') },
    { label: 'No stop words',                 pass: !s.split('-').some(w => STOP_WORDS.has(w)) },
    { label: 'Minimum 3 characters',          pass: s.length >= 3 },
    { label: 'Meaningful length',             pass: s.length > 3 },
    { label: 'No trailing slash',             pass: !s.endsWith('/') },
    { label: 'URL-safe characters only',      pass: /^[a-z0-9-]*$/.test(s) },
  ];
}

// ── DATE ─────────────────────────────────────────────────────
export function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = typeof ts === 'number'
      ? new Date(ts)
      : (ts.toDate ? ts.toDate() : new Date(ts));
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// ── JSON PARSING ─────────────────────────────────────────────
export function parseJsonSafe(text) {
  if (!text || typeof text !== 'string') return null;

  const normalized = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');

  const candidates = [
    normalized,
    normalized.replace(/^[\s\S]*?\{/, '{'),
    normalized.slice(normalized.indexOf('{'), normalized.lastIndexOf('}') + 1),
    normalized.replace(/\n/g, ' ')
  ];

  for (const candidate of candidates) {
    if (!candidate || !candidate.includes('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const repaired = candidate.replace(/"(?:[^"\\]|\\.)*"/g, m =>
          m.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, ' ')
        );
        return JSON.parse(repaired);
      } catch {
        // continue to the next candidate
      }
    }
  }

  const msgMatch = normalized.match(/\{\s*"(?:meta_title|meta_description|focus_keywords|seo_slug|alt_text|product_description|short_description|product_tags|socialMedia)"/i);
  if (msgMatch) {
    try {
      return JSON.parse(msgMatch[0] + normalized.slice(msgMatch.index + msgMatch[0].length).match(/\}.*/s)?.[0] || '{}');
    } catch {
      return null;
    }
  }

  return null;
}

// ── IMAGE COMPRESSION ────────────────────────────────────────
export function compressImage(file, maxDim = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else       { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), w, h });
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressDataUrl(dataUrl, maxDim = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else       { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ── FIRESTORE SANITISE ───────────────────────────────────────
/** Recursively remove undefined values (Firestore rejects them) */
export function sanitiseForFirestore(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v));
}

// ── SEO SCORE ────────────────────────────────────────────────
/**
 * Comprehensive SEO scoring engine.
 *
 * Evaluates 16 signals across 6 dimensions:
 *   1. Technical length compliance   (meta title, description)
 *   2. Keyword placement             (title, description, slug, alt)
 *   3. Readability & CTR quality     (title uniqueness, CTA presence)
 *   4. Search intent & relevance     (product name in key fields)
 *   5. Content richness              (description depth, word count)
 *   6. Structural quality            (slug cleanliness, tags, keywords)
 *
 * Score is computed from real signal checks — never from AI output.
 * Each check has an individual weight; total is normalised to 0-100.
 */
export function computeSeoScore(r) {
  const title    = safeStr(r.meta_title).trim();
  const desc     = safeStr(r.meta_description).trim();
  const slug     = safeStr(r.seo_slug).trim();
  const prodDesc = safeStr(r.product_description).trim();
  const alt      = safeStr(r.alt_text).trim();
  const pName    = safeStr(r.productName).toLowerCase();
  const cat      = safeStr(r.category).toLowerCase();

  // Tokenise product name into meaningful words (length > 2, no stop words)
  const pWords = pName.split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const descLower  = desc.toLowerCase();
  const titleLower = title.toLowerCase();
  const descWords  = prodDesc.split(/\s+/).filter(Boolean).length;
  const descSents  = Math.max((prodDesc.match(/[.!?]+/g) || []).length, 0);
  const normCat    = _normalizeText(cat);
  const catTerms   = new Set(normCat.split(' ').filter(term => term.length >= 3 && !STOP_WORDS.has(term)));

  // ── Helper: does field contain at least one product keyword? ──
  const hasProductKw = (text) => pWords.some(w => text.toLowerCase().includes(w));
  const hasCategoryContext = (text) => {
    const normalized = _normalizeText(text);
    const words = new Set(normalized.split(' ').filter(Boolean));
    for (const term of catTerms) {
      if (term.length < 3) continue;
      if (words.has(term)) return true;
      const synonyms = CATEGORY_SYNONYMS[term];
      if (synonyms && synonyms.some(syn => words.has(syn))) return true;
    }
    return false;
  };

  // ── Helper: does field contain a CTA-like phrase? ──────────
  const CTA_PATTERNS = /\b(buy|shop|order|get|discover|explore|view|check|grab|save|find|try|visit|see)\b/i;
  const hasCTA = (text) => CTA_PATTERNS.test(text);

  // ── Helper: does field have a brand/product name mention? ──
  const hasBrand = (text) => {
    const lower = text.toLowerCase();
    return pWords.some(w => lower.includes(w)) || lower.includes(pName.split(' ')[0]);
  };

  // ── Individual signal checks ────────────────────────────────
  const checks = [
    // 1. Technical length
    {
      label:  'Meta Title length (50-70 chars)',
      field:  'meta_title',
      weight: 10,
      pass:   title.length >= 50 && title.length <= 70
    },
    {
      label:  'Meta Description length (140-160 chars)',
      field:  'meta_description',
      weight: 10,
      pass:   desc.length >= 140 && desc.length <= 160
    },

    // 2. Keyword placement
    {
      label:  'Product keyword in Meta Title',
      field:  'meta_title',
      weight: 12,
      pass:   hasProductKw(title)
    },
    {
      label:  'Product keyword in Meta Description',
      field:  'meta_description',
      weight: 10,
      pass:   hasProductKw(desc)
    },
    {
      label:  'Product keyword in SEO Slug',
      field:  'seo_slug',
      weight: 8,
      pass:   hasProductKw(slug)
    },
    {
      label:  'Product keyword in Image Alt Text',
      field:  'alt_text',
      weight: 6,
      pass:   hasProductKw(alt)
    },

    // 3. CTR quality
    {
      label:  'Call-to-action in Meta Description',
      field:  'meta_description',
      weight: 8,
      pass:   hasCTA(desc)
    },
    {
      label:  'Meta Title is unique and specific',
      field:  'meta_title',
      weight: 6,
      pass:   title.length > 0 && !(/elevate your|discover|introducing|shop now|buy now/i.test(title))
    },

    // 4. Search intent & product relevance
    {
      label:  'Category context in Description',
      field:  'product_description',
      weight: 6,
      pass:   cat.length > 0 && hasCategoryContext(prodDesc)
    },
    {
      label:  'Brand / Product name mentioned',
      field:  'product_description',
      weight: 6,
      pass:   hasBrand(prodDesc)
    },

    // 5. Content richness & readability
    {
      label:  'Product Description 200+ words',
      field:  'product_description',
      weight: 10,
      pass:   descWords >= 200
    },
    {
      label:  'Product Description 3+ sentences',
      field:  'product_description',
      weight: 4,
      pass:   descSents >= 3
    },
    {
      label:  'Image Alt Text present',
      field:  'alt_text',
      weight: 4,
      pass:   alt.length > 0
    },

    // 6. Structural quality
    {
      label:  'Clean SEO URL Slug',
      field:  'seo_slug',
      weight: 6,
      pass:   slug.length > 0 && slug.length < 75 &&
              slug === slug.toLowerCase() &&
              !/\s/.test(slug) &&
              !/[|&%@#*]/.test(slug)
    },
    {
      label:  'Focus Keywords (5+)',
      field:  'focus_keywords',
      weight: 6,
      pass:   Array.isArray(r.focus_keywords) && r.focus_keywords.length >= 5
    },
    {
      label:  'Product Tags (5+)',
      field:  'product_tags',
      weight: 4,
      pass:   Array.isArray(r.product_tags) && r.product_tags.length >= 5
    }
  ];

  // Weighted score: sum of weights for passing checks / total weight * 100
  const totalWeight  = checks.reduce((sum, c) => sum + c.weight, 0);
  const passedWeight = checks.filter(c => c.pass).reduce((sum, c) => sum + c.weight, 0);
  const score        = Math.round((passedWeight / totalWeight) * 100);

  // Unique failing fields (for section-level improvement targeting)
  const failed = [...new Set(checks.filter(c => !c.pass).map(c => c.field))];

  const cat_label =
    score >= 92 ? { label: 'Excellent', color: '#10b981' } :
    score >= 78 ? { label: 'Good',      color: '#3b82f6' } :
    score >= 58 ? { label: 'Fair',      color: '#f59e0b' } :
                  { label: 'Poor',      color: '#ef4444' };

  return { score, checks, failed, cat: cat_label };
}
