export { DEFAULT_PRODUCT_IMAGES } from './productCatalog.js';

export const CATEGORY_EMOJI = {
  Milchprodukte: '🥛',
  Backwaren: '🍞',
  Getränke: '☕',
};

const IMAGE_SIZES = { xs: 48, sm: 64, md: 96, lg: 128 };

/** Kleine Vorschaubilder – REWE-Originale sind oft >1 MB und laden auf dem Handy nicht. */
export function toDisplayImageUrl(url, size = 'md') {
  if (!url) return null;
  if (url.includes('images.weserv.nl')) return url;

  const px = IMAGE_SIZES[size] ?? 96;
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(withoutProtocol)}&w=${px}&h=${px}&fit=contain&output=webp`;
}

export function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] ?? '🛒';
}

export function productImageHtml(imageUrl, name, category = '', size = 'md') {
  const emoji = getCategoryEmoji(category);
  const displayUrl = toDisplayImageUrl(imageUrl, size);

  if (displayUrl) {
    const fallback = `<span class="product-img-fallback product-img--${size}" aria-hidden="true">${emoji}</span>`;
    return `<img src="${escapeAttr(displayUrl)}" alt="${escapeAttr(name)}" class="product-img product-img--${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.replaceWith((()=>{const s=document.createElement('span');s.className='product-img-fallback product-img--${size}';s.textContent='${emoji}';return s;})())" />`;
  }
  return `<span class="product-img-fallback product-img--${size}" aria-hidden="true">${emoji}</span>`;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
