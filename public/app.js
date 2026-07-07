import { productImageHtml } from './productImages.js';

function resolveApiBase() {
  const configured = window.APP_CONFIG?.API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, '');

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return '/api';
  }

  return '';
}

const API = resolveApiBase();
const DEMO_MODE = !API;

const state = {
  stores: [],
  products: [],
  uploadedFile: null,
  detectedItems: [],
  selectedStoreId: null,
  priceChart: null,
  selectedProduct: null,
};

// ── DOM References ──────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  toast: $('#toast'),
  dropZone: $('#drop-zone'),
  fileInput: $('#file-input'),
  dropPlaceholder: $('#drop-placeholder'),
  previewImage: $('#preview-image'),
  scanOverlay: $('#scan-overlay'),
  storeSelect: $('#store-select'),
  btnAnalyze: $('#btn-analyze'),
  btnSave: $('#btn-save'),
  analyzeStatus: $('#analyze-status'),
  resultsEmpty: $('#results-empty'),
  resultsTableWrap: $('#results-table-wrap'),
  resultsTbody: $('#results-tbody'),
  resultsTotal: $('#results-total'),
  productSearch: $('#product-search'),
  productBrowserList: $('#product-browser-list'),
  productBrowserCount: $('#product-browser-count'),
  chartEmpty: $('#chart-empty'),
  chartPanel: $('#chart-panel'),
  chartProductName: $('#chart-product-name'),
  chartMeta: $('#chart-meta'),
  chartStats: $('#chart-stats'),
  chartProductImage: $('#chart-product-image'),
  priceChart: $('#price-chart'),
  optimizerLoading: $('#optimizer-loading'),
  optimizerEmpty: $('#optimizer-empty'),
  optimizerContent: $('#optimizer-content'),
  optimizerSummary: $('#optimizer-summary'),
  optimizerCards: $('#optimizer-cards'),
  lookupLoading: $('#lookup-loading'),
  lookupPanel: $('#lookup-panel'),
  lookupDisclaimer: $('#lookup-disclaimer'),
  lookupComparisons: $('#lookup-comparisons'),
  lookupInternetList: $('#lookup-internet-list'),
  lookupInternetTbody: $('#lookup-internet-tbody'),
};

// ── API Helpers ─────────────────────────────────────────────
async function api(path, options = {}) {
  if (DEMO_MODE) {
    const { demoApi } = await import('./demoApi.js');
    return demoApi(path, options);
  }
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// ── Toast ───────────────────────────────────────────────────
function showToast(message, type = 'success') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 3500);
}

// ── Formatters ──────────────────────────────────────────────
function formatPrice(price) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price);
}

function formatDate(dateStr) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(dateStr)
  );
}

function storeDotClass(name) {
  const lower = name.toLowerCase();
  if (lower.includes('lidl')) return 'lidl';
  if (lower.includes('aldi')) return 'aldi';
  if (lower.includes('rewe')) return 'rewe';
  return 'other';
}

// ── Navigation ──────────────────────────────────────────────
function initNavigation() {
  $$('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      $$('.nav-tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      $$('.view').forEach((v) => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      const targetView = $(`#view-${view}`);
      if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active');
      }
      if (view === 'optimizer') loadOptimizer();
    });
  });
}

// ── Init Data ───────────────────────────────────────────────
async function loadInitialData() {
  try {
    const [storesRes, productsRes] = await Promise.all([
      api('/stores'),
      api('/products'),
    ]);
    state.stores = storesRes.stores;
    state.products = productsRes.products;
    populateStoreSelect();
    renderProductBrowser('');
    initProductSearch();
  } catch (err) {
    showToast(`Daten konnten nicht geladen werden: ${err.message}`, 'error');
  }
}

function populateStoreSelect() {
  els.storeSelect.innerHTML = '<option value="">Laden wählen…</option>';
  for (const store of state.stores) {
    const opt = document.createElement('option');
    opt.value = store.id;
    opt.textContent = store.name;
    els.storeSelect.appendChild(opt);
  }
}

// ── Upload / Drag & Drop ────────────────────────────────────
function initUpload() {
  els.dropZone.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('drag-over');
    });
  });

  els.dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleFile(file);
  });

  els.storeSelect.addEventListener('change', () => {
    state.selectedStoreId = els.storeSelect.value ? Number(els.storeSelect.value) : null;
    updateAnalyzeButton();
  });

  els.btnAnalyze.addEventListener('click', runAiAnalysis);
  els.btnSave.addEventListener('click', saveReceipt);
}

function handleFile(file) {
  state.uploadedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    els.previewImage.src = e.target.result;
    els.previewImage.classList.remove('hidden');
    els.dropPlaceholder.classList.add('hidden');
    els.dropZone.classList.add('has-image');
    els.scanOverlay.classList.remove('hidden');
    els.scanOverlay.classList.add('active');
    updateAnalyzeButton();
  };
  reader.readAsDataURL(file);
}

function updateAnalyzeButton() {
  els.btnAnalyze.disabled = !(state.uploadedFile && state.selectedStoreId);
}

function setAnalyzeStatus(status, text) {
  els.analyzeStatus.className = `status-badge ${status}`;
  els.analyzeStatus.textContent = text;
}

async function runAiAnalysis() {
  if (!state.uploadedFile || !state.selectedStoreId) return;

  els.btnAnalyze.disabled = true;
  setAnalyzeStatus('scanning', 'Scannt…');
  els.scanOverlay.classList.add('active');

  await delay(2500);

  const store = state.stores.find((s) => s.id === state.selectedStoreId);
  const shuffled = [...state.products].sort(() => Math.random() - 0.5);
  const count = Math.min(3 + Math.floor(Math.random() * 3), shuffled.length);
  const selected = shuffled.slice(0, count);

  state.detectedItems = selected.map((product) => ({
    product_id: product.id,
    product_name: product.name,
    image_url: product.image_url,
    store_name: store.name,
    price: +(0.79 + Math.random() * 4.5).toFixed(2),
  }));

  renderDetectedItems();
  setAnalyzeStatus('done', 'Fertig');
  els.scanOverlay.classList.remove('active');
  els.btnAnalyze.disabled = false;
}

function renderDetectedItems() {
  els.resultsEmpty.classList.add('hidden');
  els.resultsTableWrap.classList.remove('hidden');
  els.resultsTbody.innerHTML = '';

  let total = 0;
  for (const item of state.detectedItems) {
    total += item.price;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="product-cell">
          ${productImageHtml(item.image_url, item.product_name, '', 'sm')}
          <span>${item.product_name}</span>
        </div>
      </td>
      <td>${item.store_name}</td>
      <td class="text-right price-cell">${formatPrice(item.price)}</td>
    `;
    els.resultsTbody.appendChild(tr);
  }
  els.resultsTotal.textContent = formatPrice(total);
}

async function saveReceipt() {
  if (state.detectedItems.length === 0) return;

  const total = state.detectedItems.reduce((sum, i) => sum + i.price, 0);
  const today = new Date().toISOString().slice(0, 10);

  try {
    els.btnSave.disabled = true;
    await api('/receipts', {
      method: 'POST',
      body: JSON.stringify({
        store_id: state.selectedStoreId,
        date: today,
        total_price: +total.toFixed(2),
        items: state.detectedItems.map((i) => ({
          product_id: i.product_id,
          price: i.price,
        })),
      }),
    });
    showToast('Kassenbon erfolgreich gespeichert!');
    resetUpload();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    els.btnSave.disabled = false;
  }
}

function resetUpload() {
  state.uploadedFile = null;
  state.detectedItems = [];
  els.previewImage.classList.add('hidden');
  els.previewImage.src = '';
  els.dropPlaceholder.classList.remove('hidden');
  els.dropZone.classList.remove('has-image');
  els.scanOverlay.classList.add('hidden');
  els.scanOverlay.classList.remove('active');
  els.resultsEmpty.classList.remove('hidden');
  els.resultsTableWrap.classList.add('hidden');
  els.fileInput.value = '';
  setAnalyzeStatus('idle', 'Bereit');
  updateAnalyzeButton();
}

// ── Price Checker ───────────────────────────────────────────

function filterProducts(query) {
  const q = query.trim().toLowerCase();
  if (!q) return state.products;
  return state.products.filter(
    (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  );
}

function renderProductBrowser(query = '') {
  const matches = filterProducts(query);
  els.productBrowserCount.textContent = `${matches.length} von ${state.products.length} Produkten`;

  if (matches.length === 0) {
    els.productBrowserList.innerHTML =
      '<p class="product-browser-empty">Keine Produkte gefunden</p>';
    return;
  }

  els.productBrowserList.innerHTML = '';
  for (const product of matches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'product-browser-item';
    if (state.selectedProduct?.id === product.id) {
      btn.classList.add('selected');
    }
    btn.innerHTML = `
      ${productImageHtml(product.image_url, product.name, product.category, 'sm')}
      <div class="product-browser-item-text">
        <span class="product-browser-item-name">${product.name}</span>
        <span class="product-browser-item-category">${product.category}</span>
      </div>
    `;
    btn.addEventListener('click', () => selectProduct(product));
    els.productBrowserList.appendChild(btn);
  }
}

function initProductSearch() {
  els.productSearch.addEventListener('input', () => {
    const query = els.productSearch.value;
    renderProductBrowser(query);
  });

  els.productSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const matches = filterProducts(els.productSearch.value);
      if (matches.length > 0) selectProduct(matches[0]);
    }
  });
}

async function selectProduct(product) {
  state.selectedProduct = product;
  renderProductBrowser(els.productSearch.value);

  els.chartEmpty.classList.add('hidden');
  els.lookupPanel.classList.add('hidden');
  els.lookupLoading.classList.remove('hidden');

  try {
    const [historyData] = await Promise.all([
      api(`/products/history/${product.id}`),
      fetchPriceLookup(product.name),
    ]);
    renderPriceChart(historyData);
  } catch (err) {
    els.lookupLoading.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

function hideLookupPanel() {
  els.lookupLoading.classList.add('hidden');
  els.lookupPanel.classList.add('hidden');
}

async function fetchPriceLookup(query) {
  hideLookupPanel();
  els.lookupLoading.classList.remove('hidden');

  try {
    const data = await api(`/prices/lookup?q=${encodeURIComponent(query)}`);
    els.lookupLoading.classList.add('hidden');
    renderPriceLookup(data);
  } catch (err) {
    els.lookupLoading.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

function renderPriceLookup(data) {
  els.lookupPanel.classList.remove('hidden');
  els.lookupDisclaimer.textContent =
    data.internet.disclaimer || 'Online-Preise können von Ladenpreisen abweichen.';

  els.lookupComparisons.innerHTML = '';

  if (data.comparisons.length === 0) {
    els.lookupComparisons.innerHTML =
      '<p class="text-sm text-slate-500">Keine Vergleichsdaten gefunden.</p>';
  } else {
    for (const item of data.comparisons) {
      const card = document.createElement('div');
      card.className = 'comparison-card';
      const localHtml = item.local_prices?.length
        ? item.local_prices
            .map(
              (s) =>
                `<span class="local-price-tag">${s.store_name}: ${formatPrice(s.price)}</span>`
            )
            .join('')
        : '<span class="text-slate-500 text-sm">Keine Bon-Daten</span>';

      const internetHtml = item.internet_cheapest
        ? `<span class="internet-price-tag">REWE Online: ${formatPrice(item.internet_cheapest.price)}</span>`
        : data.internet.error
          ? `<span class="text-slate-500 text-sm">${data.internet.error}</span>`
          : '';

      const imgUrl = item.local_image_url || item.internet_cheapest?.image_url;
      card.innerHTML = `
        <div class="comparison-card-header">
          ${productImageHtml(imgUrl, item.local_product_name || data.query, '', 'md')}
          <div class="comparison-card-title">${item.local_product_name || data.query}</div>
        </div>
        <div class="comparison-card-prices">${localHtml} ${internetHtml}</div>
        ${item.verdict ? `<p class="comparison-verdict">${item.verdict}</p>` : ''}
      `;
      els.lookupComparisons.appendChild(card);
    }
  }

  if (data.internet.products?.length) {
    els.lookupInternetList.classList.remove('hidden');
    els.lookupInternetTbody.innerHTML = data.internet.products
      .map(
        (p) => `
      <tr>
        <td>
          <div class="product-cell">
            ${productImageHtml(p.image_url, p.name, '', 'sm')}
            <span>${p.name}</span>
          </div>
        </td>
        <td class="text-slate-400">${p.grammage || '–'}</td>
        <td class="text-right price-cell">${formatPrice(p.price)}</td>
      </tr>
    `
      )
      .join('');
  } else {
    els.lookupInternetList.classList.add('hidden');
    els.lookupInternetTbody.innerHTML = '';
  }
}

function renderPriceChart(data) {
  if (data.history.length === 0) {
    els.chartPanel.classList.add('hidden');
    els.chartEmpty.classList.remove('hidden');
    els.chartEmpty.querySelector('p').textContent = 'Noch keine Bon-Daten für dieses Produkt';
    const hint = els.chartEmpty.querySelector('.text-sm');
    if (hint) hint.textContent = 'Online-Preise findest du unten im REWE-Vergleich';
    return;
  }

  els.chartEmpty.classList.add('hidden');
  els.chartPanel.classList.remove('hidden');

  if (els.chartProductImage) {
    els.chartProductImage.innerHTML = productImageHtml(
      data.image_url,
      data.product_name,
      data.category,
      'lg'
    );
  }
  els.chartProductName.textContent = data.product_name;
  els.chartMeta.textContent = `${data.history.length} Preiseinträge`;

  const prices = data.history.map((h) => h.price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const change = first ? ((last - first) / first) * 100 : 0;
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  els.chartStats.innerHTML = `
    <div class="stat-pill">
      <div class="stat-value">${formatPrice(last ?? 0)}</div>
      <div class="stat-label">Aktuell</div>
    </div>
    <div class="stat-pill ${change > 0 ? 'negative' : ''}">
      <div class="stat-value">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</div>
      <div class="stat-label">Veränderung</div>
    </div>
    <div class="stat-pill">
      <div class="stat-value">${formatPrice(min)} – ${formatPrice(max)}</div>
      <div class="stat-label">Spanne</div>
    </div>
  `;

  const labels = [...new Set(data.history.map((h) => h.date))].sort();

  const byStore = {};
  for (const entry of data.history) {
    if (!byStore[entry.store_name]) byStore[entry.store_name] = {};
    byStore[entry.store_name][entry.date] = entry.price;
  }

  const storeColors = {};
  const palette = ['#00ff9d', '#00d4ff', '#a78bfa', '#f472b6', '#fbbf24'];
  let colorIdx = 0;

  const datasets = Object.entries(byStore).map(([storeName, pricesByDate]) => {
    if (!storeColors[storeName]) {
      storeColors[storeName] = palette[colorIdx++ % palette.length];
    }
    return {
      label: storeName,
      data: labels.map((date) => pricesByDate[date] ?? null),
      borderColor: storeColors[storeName],
      backgroundColor: storeColors[storeName] + '22',
      borderWidth: 2.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointBackgroundColor: storeColors[storeName],
      tension: 0.35,
      fill: true,
      spanGaps: true,
    };
  });

  if (state.priceChart) state.priceChart.destroy();

  state.priceChart = new Chart(els.priceChart, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Inter' }, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          labels,
          ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            callback: (v) => formatPrice(v),
          },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
      },
    },
  });
}

// ── Spar-Optimierer ─────────────────────────────────────────
let optimizerEnrichAbort = false;

async function loadOptimizer() {
  optimizerEnrichAbort = true;
  els.optimizerLoading.classList.remove('hidden');
  els.optimizerEmpty.classList.add('hidden');
  els.optimizerContent.classList.add('hidden');

  try {
    const data = await api('/compare');
    const comparisons = data.comparisons;

    els.optimizerLoading.classList.add('hidden');

    if (comparisons.length === 0) {
      els.optimizerEmpty.classList.remove('hidden');
      return;
    }

    renderOptimizer(comparisons);
    els.optimizerContent.classList.remove('hidden');
    enrichOptimizerWithRewe(comparisons);
  } catch (err) {
    els.optimizerLoading.classList.add('hidden');
    showToast(err.message, 'error');
  }
}

async function enrichOptimizerWithRewe(comparisons) {
  optimizerEnrichAbort = false;
  const needsRewe = comparisons.filter((c) => c.stores.length === 0);
  if (needsRewe.length === 0) return;

  const { fetchRewePricesBrowser } = await import('./reweClient.js');

  for (let i = 0; i < needsRewe.length; i++) {
    if (optimizerEnrichAbort) return;
    const product = needsRewe[i];
    try {
      const { products } = await fetchRewePricesBrowser(product.product_name, 1);
      if (optimizerEnrichAbort) return;
      if (products.length > 0) {
        const rewe = products[0];
        product.stores = [
          {
            store_id: null,
            store_name: 'REWE Online',
            latest_price: rewe.price,
            latest_date: new Date().toISOString().slice(0, 10),
            is_internet: true,
          },
        ];
        product.cheapest_store = 'REWE Online';
        product.cheapest_price = rewe.price;
        updateOptimizerCard(product);
      }
    } catch {
      // Einzelnes Produkt überspringen
    }
    if (i < needsRewe.length - 1) await delay(250);
  }
}

function updateOptimizerCard(product) {
  const cards = els.optimizerCards.querySelectorAll('.product-card');
  for (const card of cards) {
    if (card.dataset.productId !== String(product.product_id)) continue;

    const badge = card.querySelector('.cheapest-badge');
    if (badge && product.cheapest_store) {
      badge.textContent = `✓ ${product.cheapest_store} · ${formatPrice(product.cheapest_price)}`;
      badge.classList.remove('loading');
    }

    const noData = card.querySelector('.no-data');
    if (noData && product.stores.length > 0) {
      const storeRows = product.stores
        .sort((a, b) => a.latest_price - b.latest_price)
        .map((s) => {
          const isCheapest = s.store_name === product.cheapest_store;
          return `
            <div class="store-row ${isCheapest ? 'cheapest' : ''}">
              <div class="store-name">
                <span class="store-dot ${storeDotClass(s.store_name)}"></span>
                ${s.store_name}
              </div>
              <div class="text-right">
                <div class="store-price">${formatPrice(s.latest_price)}</div>
                <div class="store-date">${formatDate(s.latest_date)}</div>
              </div>
            </div>
          `;
        })
        .join('');
      noData.outerHTML = storeRows;
    }
    break;
  }
}

function renderOptimizer(comparisons) {
  const withLocalData = comparisons.filter((c) =>
    c.stores.some((s) => !s.is_internet)
  );
  const storeWins = {};
  for (const c of withLocalData) {
    if (c.cheapest_store) {
      storeWins[c.cheapest_store] = (storeWins[c.cheapest_store] || 0) + 1;
    }
  }

  const topStore = Object.entries(storeWins).sort((a, b) => b[1] - a[1])[0];

  els.optimizerSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-value">${comparisons.length}</div>
      <div class="summary-label">Produkte im Katalog</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${withLocalData.length}</div>
      <div class="summary-label">Mit Bon-Daten</div>
    </div>
    <div class="summary-card">
      <div class="summary-value">${topStore ? topStore[0] : '–'}</div>
      <div class="summary-label">Günstigster Laden (Bon)</div>
    </div>
  `;

  els.optimizerCards.innerHTML = '';
  for (const product of comparisons) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.dataset.productId = product.product_id;

    const hasLocal = product.stores.some((s) => !s.is_internet);
    const storeRows = product.stores.length
      ? product.stores
          .sort((a, b) => a.latest_price - b.latest_price)
          .map((s) => {
            const isCheapest = s.store_name === product.cheapest_store;
            return `
              <div class="store-row ${isCheapest ? 'cheapest' : ''}">
                <div class="store-name">
                  <span class="store-dot ${storeDotClass(s.store_name)}"></span>
                  ${s.store_name}
                  ${s.is_internet ? '<span class="internet-tag">Online</span>' : ''}
                </div>
                <div class="text-right">
                  <div class="store-price">${formatPrice(s.latest_price)}</div>
                  <div class="store-date">${formatDate(s.latest_date)}</div>
                </div>
              </div>
            `;
          })
          .join('')
      : '<p class="no-data">REWE-Preis wird geladen…</p>';

    const badgeContent = product.cheapest_store
      ? `✓ ${product.cheapest_store} · ${formatPrice(product.cheapest_price)}`
      : hasLocal
        ? 'Kein Preis'
        : 'REWE wird geladen…';

    card.innerHTML = `
      <div class="product-card-header">
        <div class="product-card-title-row">
          ${productImageHtml(product.image_url, product.product_name, product.category, 'md')}
          <div>
            <div class="product-card-name">${product.product_name}</div>
            <div class="product-card-category">${product.category}</div>
          </div>
        </div>
        <div class="cheapest-badge ${product.cheapest_store ? '' : 'loading'}">
          ${badgeContent}
        </div>
      </div>
      ${storeRows}
    `;
    els.optimizerCards.appendChild(card);
  }
}

// ── Utils ───────────────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Boot ────────────────────────────────────────────────────
function initDemoBanner() {
  if (!DEMO_MODE) return;
  const banner = document.createElement('div');
  banner.className = 'demo-banner demo-banner--live';
  banner.innerHTML = `
    <span>🌐 <strong>Live-Modus</strong> – Echte REWE-Preise &amp; Produktbilder</span>
    <span class="demo-banner-hint">Deine Bons werden lokal im Browser gespeichert</span>
  `;
  document.querySelector('header')?.after(banner);
}

initNavigation();
initUpload();
initDemoBanner();
loadInitialData();
