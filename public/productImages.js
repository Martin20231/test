export const DEFAULT_PRODUCT_IMAGES = {
  Milch: 'https://img.rewe-static.de/1042422/8646730_digital-image.png',
  Butter: 'https://img.rewe-static.de/6656935/32203086_digital-image.png',
  Brot: 'https://img.rewe-static.de/9533282/51429412_digital-image.png',
  Eier: 'https://img.rewe-static.de/1124551/23473683_digital-image.png',
  Kaffee: 'https://img.rewe-static.de/6243827/24412513_digital-image.png',
};

export const CATEGORY_EMOJI = {
  Milchprodukte: '🥛',
  Backwaren: '🍞',
  Getränke: '☕',
};

export function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] ?? '🛒';
}

export function productImageHtml(imageUrl, name, category = '', size = 'md') {
  const emoji = getCategoryEmoji(category);
  if (imageUrl) {
    return `<img src="${imageUrl}" alt="${escapeAttr(name)}" class="product-img product-img--${size}" loading="lazy" onerror="this.outerHTML='<span class=\\'product-img-fallback product-img--${size}\\'>${emoji}</span>'" />`;
  }
  return `<span class="product-img-fallback product-img--${size}" aria-hidden="true">${emoji}</span>`;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
