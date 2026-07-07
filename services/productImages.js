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
  Obst: '🍎',
  Gemüse: '🥬',
};

export function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] ?? '🛒';
}

export function resolveProductImage(product, internetProducts = []) {
  if (product?.image_url) return product.image_url;

  const name = product?.name ?? product?.product_name ?? '';
  if (DEFAULT_PRODUCT_IMAGES[name]) return DEFAULT_PRODUCT_IMAGES[name];

  const match = internetProducts.find((p) =>
    p.name?.toLowerCase().includes(name.toLowerCase())
  );
  if (match?.image_url) return match.image_url;

  return null;
}
