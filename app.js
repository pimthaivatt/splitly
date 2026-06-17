const PALETTE = [
  ['#06C755','#00B900'], ['#3B82F6','#1D4ED8'], ['#F59E0B','#D97706'],
  ['#EF4444','#DC2626'], ['#8B5CF6','#7C3AED'], ['#EC4899','#DB2777'],
  ['#06B6D4','#0891B2'], ['#84CC16','#65A30D'], ['#F97316','#EA580C'],
  ['#14B8A6','#0D9488'],
];
const state = {
  people: [],
  // Multiple receipts. Each receipt has its own items, tax, tip.
  // `combineMode`:
  //   - 'separate': show one receipt at a time via tabs; summary aggregates across ALL receipts per person.
  //   - 'pool':     merge every receipt's items into one pile, one tax, one tip.
  receipts: [],
  activeReceiptId: null,
  combineMode: 'separate',
  mode: 'manual',
  currency: '$',
  liffReady: false,
  lineUser: null,
};
let nextId = 1;
const uid = () => 'id_' + (nextId++);

// ---------- Receipt helpers ----------
function makeReceipt(label) {
  const id = uid();
  return {
    id,
    label: label || `Receipt ${state.receipts.length + 1}`,
    items: [],
    tax: 0, taxMode: 'amount',
    tip: 0, tipMode: 'amount',
    discount: 0, discountMode: 'amount',
  };
}
// Back-compat upgrade: existing receipts may not have mode fields
function upgradeReceipt(r) {
  if (r.taxMode == null) r.taxMode = 'amount';
  if (r.tipMode == null) r.tipMode = 'amount';
  if (r.discount == null) r.discount = 0;
  if (r.discountMode == null) r.discountMode = 'amount';
}
// Convert a raw value + mode + subtotal → effective amount
function effectiveAmount(value, mode, subtotal) {
  const v = +value || 0;
  if (mode === 'percent') return (subtotal * v) / 100;
  return v;
}
function ensureReceipt() {
  if (state.receipts.length === 0) {
    const r = makeReceipt('Receipt 1');
    state.receipts.push(r);
    state.activeReceiptId = r.id;
  }
  state.receipts.forEach(upgradeReceipt);
  if (!state.receipts.find(r => r.id === state.activeReceiptId)) {
    state.activeReceiptId = state.receipts[0].id;
  }
  return activeReceipt();
}
function activeReceipt() {
  return state.receipts.find(r => r.id === state.activeReceiptId) || state.receipts[0] || null;
}
function allItems() { return state.receipts.flatMap(r => r.items); }
function findItemAcross(itemId) {
  for (const r of state.receipts) {
    const it = r.items.find(x => x.id === itemId);
    if (it) return { receipt: r, item: it };
  }
  return null;
}
function setActiveReceipt(id) {
  state.activeReceiptId = id;
  syncTaxTipInputs();
  render();
}
function addReceipt() {
  const r = makeReceipt();
  state.receipts.push(r);
  state.activeReceiptId = r.id;
  syncTaxTipInputs();
  render();
}
function removeReceipt(id) {
  if (state.receipts.length <= 1) { toast('Keep at least one receipt'); return; }
  if (!confirm('Remove this receipt and its items?')) return;
  state.receipts = state.receipts.filter(r => r.id !== id);
  ensureReceipt();
  syncTaxTipInputs();
  render();
}
function renameReceipt(id, label) {
  const r = state.receipts.find(x => x.id === id);
  if (r) r.label = label || r.label;
  render();
}
function removeActiveReceipt() {
  const r = activeReceipt();
  if (r) removeReceipt(r.id);
}
// Lightweight re-render just for the tab labels while user is typing in the label input
function renderTabsOnly() {
  const receiptTabs = document.getElementById('receiptTabs');
  if (!receiptTabs || state.receipts.length <= 1 || state.combineMode !== 'separate') { render(); return; }
  receiptTabs.innerHTML = state.receipts.map(r => `
    <button type="button" class="receipt-tab ${r.id === state.activeReceiptId ? 'active' : ''}" onclick="setActiveReceipt('${r.id}')">
      ${escapeHtml(r.label)} <span class="count">${r.items.length}</span>
    </button>
  `).join('') + `<button type="button" class="receipt-tab add" onclick="addReceipt()">+ Add receipt</button>`;
}
function setCombineMode(mode) {
  state.combineMode = mode;
  syncTaxTipInputs();
  render();
}
// Sync the tax/tip/discount inputs + mode pills to reflect the current scope
// (active receipt in separate mode, or receipts[0] in pool mode).
function syncTaxTipInputs() {
  const scope = getAmountScope();
  if (!scope) return;
  _setFieldUI('tax', scope.tax, scope.taxMode);
  _setFieldUI('tip', scope.tip, scope.tipMode);
  _setFieldUI('discount', scope.discount, scope.discountMode);
}
// Which receipt currently "owns" the tax/tip/discount inputs?
// Pool mode: receipts[0]. Separate mode: the active receipt.
function getAmountScope() {
  if (state.receipts.length === 0) return null;
  if (state.combineMode === 'pool') return state.receipts[0];
  return activeReceipt();
}
function _setFieldUI(kind, value, mode) {
  const inputEl = document.getElementById(kind + 'Amount');
  if (inputEl) inputEl.value = (+value > 0) ? (+value).toFixed(2) : '';
  const amtBtn = document.getElementById(kind + 'ModeAmount');
  const pctBtn = document.getElementById(kind + 'ModePercent');
  if (amtBtn) amtBtn.classList.toggle('active', mode !== 'percent');
  if (pctBtn) pctBtn.classList.toggle('active', mode === 'percent');
}
function _writeField(kind, value, mode) {
  const scope = getAmountScope();
  if (!scope) return;
  if (state.combineMode === 'pool') {
    // Apply value/mode to receipts[0]; zero out value on others but keep their modes
    state.receipts.forEach((r, idx) => {
      if (idx === 0) {
        if (value !== undefined) r[kind] = value;
        if (mode !== undefined) r[kind + 'Mode'] = mode;
      } else {
        if (value !== undefined) r[kind] = 0;
      }
    });
  } else {
    if (value !== undefined) scope[kind] = value;
    if (mode !== undefined) scope[kind + 'Mode'] = mode;
  }
}
function onTaxInput(val)      { _writeField('tax',      parseFloat(val) || 0); render(); }
function onTipInput(val)      { _writeField('tip',      parseFloat(val) || 0); render(); }
function onDiscountInput(val) { _writeField('discount', parseFloat(val) || 0); render(); }
function setTaxMode(mode)      { _writeField('tax',      undefined, mode); syncTaxTipInputs(); render(); }
function setTipMode(mode)      { _writeField('tip',      undefined, mode); syncTaxTipInputs(); render(); }
function setDiscountMode(mode) { _writeField('discount', undefined, mode); syncTaxTipInputs(); render(); }

function fmt(n) { return state.currency + (Number(n)||0).toFixed(2); }
function initials(name) { return name.trim().split(/\s+/).map(p=>p[0]||'').join('').slice(0,2).toUpperCase(); }
function colorFor(p) { const c = PALETTE[(p.colorIdx??0)%PALETTE.length]; return `linear-gradient(135deg, ${c[0]}, ${c[1]})`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- LIFF ----------
function getLiffId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('liffId') || window.LIFF_ID || null;
}

async function initLiff() {
  const liffId = getLiffId();
  // Locale-based currency default
  try {
    const lang = (navigator.language || 'en-US');
    if (lang.startsWith('ja')) state.currency = '¥';
    else if (lang.startsWith('th')) state.currency = '฿';
    else if (lang.startsWith('zh')) state.currency = '¥';
    else if (lang.startsWith('ko')) state.currency = '₩';
  } catch(e) {}

  if (!liffId || typeof liff === 'undefined') {
    document.getElementById('liffStatus').textContent = 'Web mode';
    render();
    return;
  }
  try {
    await liff.init({ liffId });
    state.liffReady = true;
    document.getElementById('liffStatus').textContent = 'LINE';
    if (!liff.isLoggedIn()) { liff.login(); return; }
    try {
      const lang = liff.getLanguage();
      if (lang.startsWith('ja')) state.currency = '¥';
      else if (lang.startsWith('th')) state.currency = '฿';
      else if (lang.startsWith('zh')) state.currency = '¥';
      else if (lang.startsWith('ko')) state.currency = '₩';
    } catch(e) {}
    const profile = await liff.getProfile();
    state.lineUser = { userId: profile.userId, name: profile.displayName, picture: profile.pictureUrl };

    const badge = document.getElementById('userBadge');
    const pic = document.getElementById('userPic');
    const name = document.getElementById('userName');
    badge.style.display = '';
    name.textContent = state.lineUser.name;
    if (state.lineUser.picture) pic.innerHTML = `<img src="${state.lineUser.picture}" alt="" />`;
    else pic.textContent = initials(state.lineUser.name);

    if (state.people.length === 0) {
      state.people.push({ id: uid(), name: state.lineUser.name, colorIdx: 0, isMe: true, picture: state.lineUser.picture });
      document.getElementById('liffWelcome').classList.add('show');
    }
    render();
  } catch (err) {
    console.error('LIFF init failed', err);
    document.getElementById('liffStatus').textContent = 'Web mode';
    render();
  }
}

// ---------- Mode ----------
function setMode(m) {
  state.mode = m;
  document.getElementById('modeManual').classList.toggle('active', m === 'manual');
  document.getElementById('modePhoto').classList.toggle('active', m === 'photo');
  document.getElementById('manualPanel').style.display = m === 'manual' ? '' : 'none';
  document.getElementById('photoPanel').style.display = m === 'photo' ? '' : 'none';
}

// ---------- People ----------
function addPerson() {
  const input = document.getElementById('personName');
  const name = input.value.trim();
  if (!name) return;
  if (state.people.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast('Already added'); return; }
  state.people.push({ id: uid(), name, colorIdx: state.people.length });
  input.value = '';
  input.focus();
  render();
}
function removePerson(id) {
  state.people = state.people.filter(p => p.id !== id);
  state.receipts.forEach(r => {
    r.items.forEach(it => { it.assignedTo = it.assignedTo.filter(pid => pid !== id); });
  });
  render();
}

// ---------- Items ----------
function addItem(name, price, receiptId) {
  const nameInput = document.getElementById('itemName');
  const priceInput = document.getElementById('itemPrice');
  name = name ?? nameInput.value.trim();
  price = price ?? parseFloat(priceInput.value);
  if (!name || isNaN(price) || price < 0) { toast('Enter name and price'); return; }
  ensureReceipt();
  const target = receiptId
    ? state.receipts.find(r => r.id === receiptId)
    : activeReceipt();
  (target || activeReceipt()).items.push({ id: uid(), name, price, assignedTo: [] });
  if (!arguments.length) {
    nameInput.value = ''; priceInput.value = ''; nameInput.focus();
  }
  render();
}
function removeItem(id) {
  state.receipts.forEach(r => { r.items = r.items.filter(it => it.id !== id); });
  render();
}
function updateItemField(id, field, val) {
  const found = findItemAcross(id);
  if (!found) return;
  if (field === 'price') found.item.price = parseFloat(val) || 0;
  if (field === 'name') found.item.name = val;
  render();
}
function toggleAssign(itemId, personId) {
  const found = findItemAcross(itemId);
  if (!found) return;
  const item = found.item;
  const idx = item.assignedTo.indexOf(personId);
  if (idx >= 0) item.assignedTo.splice(idx, 1);
  else item.assignedTo.push(personId);
  render();
}

// ---------- Calc ----------
// Each person's totals aggregated across ALL receipts. Within each receipt,
// tax/tip/discount split proportionally by that person's assigned subtotal
// in that receipt, so people only pay tax/tip/discount for bills they joined.
// Percent mode: value is a % of that receipt's subtotal.
function calcTotals() {
  const perPerson = {};
  state.people.forEach(p => perPerson[p.id] = { subtotal: 0, items: [], tax: 0, tip: 0, discount: 0 });
  let subtotal = 0, tax = 0, tip = 0, discount = 0, unassignedSubtotal = 0;
  const perReceipt = [];

  state.receipts.forEach(r => {
    upgradeReceipt(r);
    const rSubtotal = r.items.reduce((s, it) => s + (+it.price || 0), 0);
    const rTax = effectiveAmount(r.tax, r.taxMode, rSubtotal);
    const rTip = effectiveAmount(r.tip, r.tipMode, rSubtotal);
    const rDiscount = effectiveAmount(r.discount, r.discountMode, rSubtotal);
    const rPerPerson = {};
    state.people.forEach(p => rPerPerson[p.id] = { subtotal: 0, items: [] });
    let rUnassigned = 0;

    r.items.forEach(it => {
      if (!it.assignedTo || it.assignedTo.length === 0) { rUnassigned += (+it.price || 0); return; }
      const share = (+it.price || 0) / it.assignedTo.length;
      it.assignedTo.forEach(pid => {
        if (!rPerPerson[pid]) return;
        rPerPerson[pid].subtotal += share;
        rPerPerson[pid].items.push({ name: it.name, share, shared: it.assignedTo.length > 1, sharedWith: it.assignedTo.length, receiptLabel: r.label });
        if (!perPerson[pid]) return;
        perPerson[pid].subtotal += share;
        perPerson[pid].items.push({ name: it.name, share, shared: it.assignedTo.length > 1, sharedWith: it.assignedTo.length, receiptLabel: r.label });
      });
    });

    const rAssigned = rSubtotal - rUnassigned;
    state.people.forEach(p => {
      const ps = rPerPerson[p.id];
      const ratio = rAssigned > 0 ? ps.subtotal / rAssigned : 0;
      const pTax = rTax * ratio, pTip = rTip * ratio, pDiscount = rDiscount * ratio;
      ps.tax = pTax; ps.tip = pTip; ps.discount = pDiscount;
      ps.total = ps.subtotal + pTax + pTip - pDiscount;
      if (perPerson[p.id]) {
        perPerson[p.id].tax += pTax;
        perPerson[p.id].tip += pTip;
        perPerson[p.id].discount += pDiscount;
      }
    });

    perReceipt.push({
      id: r.id, label: r.label,
      subtotal: rSubtotal, tax: rTax, tip: rTip, discount: rDiscount,
      total: rSubtotal + rTax + rTip - rDiscount,
      unassignedSubtotal: rUnassigned, perPerson: rPerPerson,
      rawTax: +r.tax || 0, taxMode: r.taxMode,
      rawTip: +r.tip || 0, tipMode: r.tipMode,
      rawDiscount: +r.discount || 0, discountMode: r.discountMode,
    });

    subtotal += rSubtotal; tax += rTax; tip += rTip; discount += rDiscount;
    unassignedSubtotal += rUnassigned;
  });

  state.people.forEach(p => {
    const ps = perPerson[p.id];
    ps.total = ps.subtotal + ps.tax + ps.tip - ps.discount;
  });

  return {
    subtotal, tax, tip, discount,
    total: subtotal + tax + tip - discount,
    perPerson, unassignedSubtotal, perReceipt,
  };
}

// ---------- Render ----------
function render() {
  ensureReceipt();
  // People
  const peopleEl = document.getElementById('peopleList');
  if (state.people.length === 0) {
    peopleEl.innerHTML = '<div class="empty">No one added yet</div>';
  } else {
    peopleEl.innerHTML = state.people.map(p => {
      const av = p.picture ? `<img src="${p.picture}" alt="" />` : escapeHtml(initials(p.name));
      return `
        <span class="person-chip ${p.isMe ? 'you' : ''}">
          <span class="mini-avatar" style="background:${colorFor(p)}">${av}</span>
          ${escapeHtml(p.name)}${p.isMe ? ' (you)' : ''}
          ${!p.isMe ? `<button onclick="removePerson('${p.id}')" aria-label="Remove">×</button>` : ''}
        </span>`;
    }).join('');
  }

  // Items + assignment
  const itemsCard = document.getElementById('itemsCard');
  const itemsList = document.getElementById('itemsList');
  const multiBar = document.getElementById('multiReceiptBar');
  const receiptTabs = document.getElementById('receiptTabs');
  const receiptToolbar = document.getElementById('receiptToolbar');
  const labelInput = document.getElementById('receiptLabelInput');
  const modeHint = document.getElementById('modeHint');
  const modeSeparateBtn = document.getElementById('modeSeparate');
  const modePoolBtn = document.getElementById('modePool');
  const taxTipScope = document.getElementById('taxTipScope');

  const totalItemCount = allItems().length;

  // Show multi-receipt bar when >1 receipt exists
  const hasMultiple = state.receipts.length > 1;
  multiBar.style.display = hasMultiple ? '' : 'none';
  modeSeparateBtn.classList.toggle('active', state.combineMode === 'separate');
  modePoolBtn.classList.toggle('active', state.combineMode === 'pool');
  modeHint.textContent = state.combineMode === 'pool'
    ? 'All items from every receipt are merged into one bill with shared tax and tip.'
    : 'Each receipt is its own bill. Switch tabs to edit. Each person\'s total below sums across all receipts.';

  // Tabs (only shown in 'separate' mode when multiple receipts)
  if (hasMultiple && state.combineMode === 'separate') {
    receiptTabs.style.display = '';
    receiptTabs.innerHTML = state.receipts.map(r => `
      <button type="button" class="receipt-tab ${r.id === state.activeReceiptId ? 'active' : ''}" onclick="setActiveReceipt('${r.id}')">
        ${escapeHtml(r.label)} <span class="count">${r.items.length}</span>
      </button>
    `).join('') + `<button type="button" class="receipt-tab add" onclick="addReceipt()">+ Add receipt</button>`;
    receiptToolbar.style.display = '';
    const r = activeReceipt();
    if (labelInput && r) labelInput.value = r.label;
  } else if (hasMultiple && state.combineMode === 'pool') {
    receiptTabs.style.display = 'none';
    receiptToolbar.style.display = 'none';
  } else {
    // Single receipt — hide tabs; still show "+ Add receipt" lightweight control
    receiptTabs.style.display = '';
    receiptTabs.innerHTML = `<button type="button" class="receipt-tab add" onclick="addReceipt()">+ Add another receipt</button>`;
    receiptToolbar.style.display = 'none';
  }

  // Tax/tip scope badge
  if (taxTipScope) {
    if (state.combineMode === 'pool' && hasMultiple) taxTipScope.textContent = '(combined)';
    else if (hasMultiple) taxTipScope.textContent = `(${activeReceipt()?.label || ''})`;
    else taxTipScope.textContent = '';
  }

  // Figure out which items to show
  let visibleItems = [];
  if (state.combineMode === 'pool') {
    visibleItems = state.receipts.flatMap(r => r.items.map(it => ({ ...it, __receiptLabel: r.label, __receiptId: r.id })));
  } else {
    const r = activeReceipt();
    visibleItems = r ? r.items.map(it => ({ ...it, __receiptLabel: r.label, __receiptId: r.id })) : [];
  }

  if (totalItemCount === 0) {
    itemsCard.style.display = 'none';
  } else {
    itemsCard.style.display = '';
    if (visibleItems.length === 0) {
      itemsList.innerHTML = '<div class="empty">No items in this receipt yet.</div>';
    } else {
      itemsList.innerHTML = visibleItems.map(it => {
        const pillsHtml = state.people.length === 0
          ? '<div class="hint">Add people first to assign this item.</div>'
          : `<div class="assign-grid">${state.people.map(p => {
              const av = p.picture ? `<img src="${p.picture}" alt="" />` : escapeHtml(initials(p.name));
              return `<span class="assign-pill ${it.assignedTo.includes(p.id) ? 'active' : ''}" onclick="toggleAssign('${it.id}','${p.id}')">
                <span class="mini-avatar" style="background:${colorFor(p)}">${av}</span>
                ${escapeHtml(p.name)}${p.isMe ? ' (you)' : ''}
              </span>`;
            }).join('')}</div>`;
        const sharedInfo = it.assignedTo.length > 1
          ? `<div class="share-info">Shared by ${it.assignedTo.length} · ${fmt(it.price/it.assignedTo.length)} each</div>`
          : '';
        const receiptTag = (state.combineMode === 'pool' && hasMultiple)
          ? `<span class="receipt-tag">${escapeHtml(it.__receiptLabel)}</span>`
          : '';
        return `
          <div class="item-row">
            <div class="top">
              <input type="text" class="name" value="${escapeHtml(it.name)}" oninput="updateItemField('${it.id}','name',this.value)" />
              ${receiptTag}
              <input type="number" class="price ${it.price === 0 ? 'needs-price' : ''}" value="${it.price.toFixed(2)}" step="0.01" min="0" inputmode="decimal" placeholder="0.00" title="${it.price === 0 ? 'Enter price' : ''}" onchange="updateItemField('${it.id}','price',this.value)" />
              <button class="btn danger" onclick="removeItem('${it.id}')" aria-label="Delete">🗑</button>
            </div>
            ${pillsHtml}
            ${sharedInfo}
          </div>`;
      }).join('');
    }
  }

  // Summary (aggregated across all receipts)
  const totals = calcTotals();
  const sumEl = document.getElementById('summary');
  const totalsEl = document.getElementById('totals');

  if (state.people.length === 0 || totalItemCount === 0) {
    sumEl.innerHTML = '<div class="empty">Add people and items to see who owes what.</div>';
  } else {
    sumEl.innerHTML = state.people.map(p => {
      const ps = totals.perPerson[p.id];
      const av = p.picture ? `<img src="${p.picture}" alt="" />` : escapeHtml(initials(p.name));
      const showReceiptTag = hasMultiple;
      const lines = ps.items.map(i => `
        <div class="line ${i.shared ? 'shared' : ''}">
          <span>${escapeHtml(i.name)}${i.shared ? ` (1/${i.sharedWith})` : ''}${showReceiptTag ? ` <span class="receipt-tag">${escapeHtml(i.receiptLabel)}</span>` : ''}</span>
          <span>${fmt(i.share)}</span>
        </div>`).join('');
      return `
        <div class="person-summary">
          <div class="head">
            <div class="avatar" style="background:${colorFor(p)}">${av}</div>
            <div class="name">${escapeHtml(p.name)}${p.isMe ? ' (you)' : ''}</div>
            <div class="total">${fmt(ps.total)}</div>
          </div>
          ${lines || '<div class="line"><em>No items assigned</em></div>'}
          <div class="line tt"><span>Subtotal</span><span>${fmt(ps.subtotal)}</span></div>
          ${totals.discount > 0 ? `<div class="line tt"><span>Discount share</span><span>−${fmt(ps.discount)}</span></div>` : ''}
          ${totals.tax > 0 ? `<div class="line tt"><span>Tax share</span><span>${fmt(ps.tax)}</span></div>` : ''}
          ${totals.tip > 0 ? `<div class="line tt"><span>Tip share</span><span>${fmt(ps.tip)}</span></div>` : ''}
          <div class="total-line"><span>Total</span><span>${fmt(ps.total)}</span></div>
        </div>`;
    }).join('');
  }

  let warn = '';
  if (totals.unassignedSubtotal > 0.001) {
    warn = `<div class="warn-banner">⚠️ ${fmt(totals.unassignedSubtotal)} of items aren't assigned yet.</div>`;
  }

  // Per-receipt breakdown (only when multiple receipts)
  let perReceiptHtml = '';
  if (hasMultiple && totals.perReceipt.length > 1) {
    perReceiptHtml = '<div class="per-receipt-breakdown">' + totals.perReceipt.map(pr => `
      <div class="totals-row"><span>${escapeHtml(pr.label)}</span><span>${fmt(pr.total)}</span></div>
    `).join('') + '</div>';
  }

  totalsEl.innerHTML = warn + perReceiptHtml + `
    <div class="totals-row"><span>Subtotal</span><span>${fmt(totals.subtotal)}</span></div>
    ${totals.discount > 0 ? `<div class="totals-row"><span>Discount</span><span>−${fmt(totals.discount)}</span></div>` : ''}
    <div class="totals-row"><span>Tax</span><span>${fmt(totals.tax)}</span></div>
    <div class="totals-row"><span>Tip</span><span>${fmt(totals.tip)}</span></div>
    <div class="totals-row grand"><span>Grand total</span><span>${fmt(totals.total)}</span></div>
  `;

  // Update the amount-field previews (show "= $X.XX" for percent mode, or "(X.X%)" for amount mode)
  updateAmountPreviews(totals);
}

// Update the preview text under each tax/tip/discount input
function updateAmountPreviews(totals) {
  const scope = getAmountScope();
  if (!scope) return;
  const isPool = state.combineMode === 'pool' && state.receipts.length > 1;
  let subtotalBasis;
  if (isPool) subtotalBasis = (totals ? totals.subtotal : state.receipts.reduce((s, r) => s + r.items.reduce((a, it) => a + (+it.price || 0), 0), 0));
  else subtotalBasis = scope.items.reduce((s, it) => s + (+it.price || 0), 0);

  ['tax', 'tip', 'discount'].forEach(kind => {
    const el = document.getElementById(kind + 'Preview');
    if (!el) return;
    const raw = +scope[kind] || 0;
    const mode = scope[kind + 'Mode'] || 'amount';
    el.className = 'amount-preview' + (kind === 'discount' ? ' discount-preview' : '');
    if (raw === 0) { el.textContent = ''; return; }
    if (mode === 'percent') {
      const amt = (subtotalBasis * raw) / 100;
      el.textContent = `= ${fmt(amt)} of ${fmt(subtotalBasis)} subtotal`;
    } else if (subtotalBasis > 0) {
      const pct = (raw / subtotalBasis) * 100;
      el.textContent = `≈ ${pct.toFixed(1)}% of subtotal`;
    } else {
      el.textContent = '';
    }
  });
}

// ---------- Share ----------
function buildSummaryText() {
  const t = calcTotals();
  const hasMultiple = state.receipts.length > 1;
  const header = hasMultiple ? `🧾 Splitly Receipt (${state.receipts.length} bills)` : '🧾 Splitly Receipt';
  const lines = [header, '═══════════════', ''];
  state.people.forEach(p => {
    const ps = t.perPerson[p.id];
    lines.push(`👤 ${p.name}${p.isMe ? ' (me)' : ''}: ${fmt(ps.total)}`);
    ps.items.forEach(i => {
      const tag = hasMultiple ? ` [${i.receiptLabel}]` : '';
      lines.push(`  • ${i.name}${i.shared ? ` (1/${i.sharedWith})` : ''}${tag}: ${fmt(i.share)}`);
    });
    if (t.discount > 0) lines.push(`  • Discount: −${fmt(ps.discount)}`);
    if (t.tax > 0) lines.push(`  • Tax: ${fmt(ps.tax)}`);
    if (t.tip > 0) lines.push(`  • Tip: ${fmt(ps.tip)}`);
    lines.push('');
  });
  if (hasMultiple) {
    lines.push('── Per-bill totals ──');
    t.perReceipt.forEach(pr => lines.push(`  ${pr.label}: ${fmt(pr.total)}`));
    lines.push('');
  }
  lines.push(`💰 Grand total: ${fmt(t.total)}`);
  return lines.join('\n');
}

function buildFlexMessage() {
  const t = calcTotals();
  const personRows = state.people.map(p => {
    const ps = t.perPerson[p.id];
    return {
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: p.name + (p.isMe ? ' (me)' : ''), size: 'sm', color: '#333333', flex: 5, weight: 'bold' },
        { type: 'text', text: fmt(ps.total), size: 'sm', color: '#06C755', align: 'end', flex: 3, weight: 'bold' }
      ]
    };
  });
  return {
    type: 'flex',
    altText: `Splitly: total ${fmt(t.total)}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#06C755', paddingAll: 'lg',
        contents: [
          { type: 'text', text: '🧾 Splitly', color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'Receipt split', color: '#FFFFFF', size: 'xs', margin: 'xs' },
          { type: 'text', text: fmt(t.total), color: '#FFFFFF', weight: 'bold', size: 'xxl', margin: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'Who owes what', size: 'xs', color: '#888888', weight: 'bold' },
          ...personRows,
          { type: 'separator', margin: 'md' },
          { type: 'box', layout: 'horizontal', margin: 'md', contents: [
            { type: 'text', text: 'Subtotal', size: 'xs', color: '#888888', flex: 5 },
            { type: 'text', text: fmt(t.subtotal), size: 'xs', color: '#888888', align: 'end', flex: 3 }
          ]},
          ...(t.discount > 0 ? [{ type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'Discount', size: 'xs', color: '#A0522D', flex: 5 },
            { type: 'text', text: '−' + fmt(t.discount), size: 'xs', color: '#A0522D', align: 'end', flex: 3 }
          ]}] : []),
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'Tax', size: 'xs', color: '#888888', flex: 5 },
            { type: 'text', text: fmt(t.tax), size: 'xs', color: '#888888', align: 'end', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'Tip', size: 'xs', color: '#888888', flex: 5 },
            { type: 'text', text: fmt(t.tip), size: 'xs', color: '#888888', align: 'end', flex: 3 }
          ]}
        ]
      }
    }
  };
}

async function sendToLINE() {
  if (state.people.length === 0) { toast('Nothing to send'); return; }
  const text = buildSummaryText();
  if (state.liffReady && typeof liff !== 'undefined') {
    try {
      if (liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker')) {
        await liff.shareTargetPicker([buildFlexMessage()]);
        toast('Shared to LINE');
        return;
      }
      if (liff.isInClient && liff.isInClient()) {
        await liff.sendMessages([{ type: 'text', text }]);
        toast('Sent to LINE chat');
        liff.closeWindow();
        return;
      }
    } catch (err) {
      console.error(err); toast('LINE share failed: ' + err.message);
    }
  }
  copyResults();
}

function copyResults() {
  const text = buildSummaryText();
  if (navigator.share) {
    navigator.share({ title: 'Receipt Split', text }).catch(() => {
      navigator.clipboard.writeText(text).then(() => toast('Copied'));
    });
  } else {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
  }
}

function resetAll() {
  if (!confirm('Clear everything?')) return;
  const me = state.people.find(p => p.isMe);
  state.people = me ? [me] : [];
  state.receipts = [];
  state.activeReceiptId = null;
  state.combineMode = 'separate';
  ensureReceipt();
  syncTaxTipInputs();
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('ocrResult').innerHTML = '';
  document.getElementById('ocrProgress').style.display = 'none';
  render();
  toast('Reset');
}

// ---------- Setup ----------
function showSetup() {
  document.getElementById('setupOverlay').classList.add('show');
  const cur = getLiffId();
  if (cur) document.getElementById('liffIdInput').value = cur;
}
function hideSetup() { document.getElementById('setupOverlay').classList.remove('show'); }
function saveLiffId() {
  const id = document.getElementById('liffIdInput').value.trim();
  if (!id) { toast('Enter a LIFF ID'); return; }
  const url = new URL(window.location.href);
  url.searchParams.set('liffId', id);
  window.location.href = url.toString();
}

// ---------- OCR ----------

// Manage user's optional OCR.space API key
function saveOcrKey() {
  const input = document.getElementById('ocrKeyInput');
  const status = document.getElementById('ocrKeyStatus');
  const k = (input.value || '').trim();
  if (!k) {
    status.textContent = 'Please paste a key first.';
    status.style.color = '#B91C1C';
    return;
  }
  localStorage.setItem('ocrSpaceKey', k);
  status.textContent = '✓ Key saved. It will be used for cloud OCR.';
  status.style.color = '#15803D';
}
function clearOcrKey() {
  localStorage.removeItem('ocrSpaceKey');
  const input = document.getElementById('ocrKeyInput');
  const status = document.getElementById('ocrKeyStatus');
  if (input) input.value = '';
  if (status) {
    status.textContent = 'Key cleared. Falling back to shared demo key.';
    status.style.color = '#6B7280';
  }
}
// Pre-fill the API key input on load if one is saved
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('ocrSpaceKey');
  const input = document.getElementById('ocrKeyInput');
  if (saved && input) input.value = saved;
});

// Convert HEIC to JPEG blob (iPhones default to HEIC)
async function ensureWebFormat(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  const isHeic = type.includes('heic') || type.includes('heif') ||
                 name.endsWith('.heic') || name.endsWith('.heif');
  if (!isHeic) return file;
  if (typeof heic2any === 'undefined') {
    throw new Error('HEIC conversion library not loaded');
  }
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  return blob instanceof Blob ? blob : blob[0];
}

// Load file as Image element
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

// Preprocess image on canvas: resize, grayscale, contrast, threshold
function preprocessImage(img, opts = {}) {
  const maxDim = opts.maxDim || 2000;
  const minDim = opts.minDim || 1200;
  const threshold = opts.threshold || false;

  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(maxDim / Math.max(w, h), 1);
  // Upscale if too small for OCR
  const upscale = Math.max(minDim / Math.max(w, h), 1);
  const finalScale = scale < 1 ? scale : upscale;
  w = Math.round(w * finalScale);
  h = Math.round(h * finalScale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Grayscale + contrast stretch (find min/max luminance)
  let min = 255, max = 0;
  const lumas = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const lum = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
    lumas[j] = lum;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  // Use 2nd-98th percentile to avoid outliers
  const hist = new Uint32Array(256);
  for (let j = 0; j < lumas.length; j++) hist[lumas[j]]++;
  const total = lumas.length;
  let cum = 0, p2 = 0, p98 = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= total * 0.02) { p2 = v; break; } }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum >= total * 0.02) { p98 = v; break; } }
  const range = Math.max(1, p98 - p2);

  if (threshold) {
    // Otsu-like threshold using midpoint of stretched histogram
    const thresh = (p2 + p98) / 2;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = lumas[j] < thresh ? 0 : 255;
      d[i] = d[i+1] = d[i+2] = v;
    }
  } else {
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v = Math.round(((lumas[j] - p2) / range) * 255);
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i+1] = d[i+2] = v;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
}

// Cloud OCR via OCR.space free API (much better on real-world photos).
// Users can paste their own free API key (25k req/month) at ocr.space/ocrapi/freekey
async function cloudOCR(blob, onProgress) {
  const key = localStorage.getItem('ocrSpaceKey') || 'K87899142388957'; // shared fallback demo key
  const form = new FormData();
  form.append('file', blob, 'receipt.jpg');
  form.append('apikey', key);
  form.append('OCREngine', '2');           // best engine for receipts
  form.append('scale', 'true');
  form.append('isTable', 'true');
  form.append('detectOrientation', 'true');
  onProgress && onProgress(0.1, 'Uploading to cloud OCR…');
  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST', body: form
  });
  if (!res.ok) throw new Error('Cloud OCR HTTP ' + res.status);
  onProgress && onProgress(0.9, 'Parsing text…');
  const data = await res.json();
  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : (data.ErrorMessage || 'Cloud OCR error');
    throw new Error(msg);
  }
  const text = (data.ParsedResults && data.ParsedResults[0] && data.ParsedResults[0].ParsedText) || '';
  onProgress && onProgress(1.0, 'Done');
  return text;
}

async function localOCR(blob, onProgress) {
  const img = await loadImage(blob);
  // Pass 1: contrast-stretched grayscale
  const canvas1 = preprocessImage(img, { maxDim: 2000, minDim: 1500, threshold: false });
  const b1 = await canvasToBlob(canvas1);
  document.getElementById('previewImg').src = URL.createObjectURL(b1);
  onProgress && onProgress(0.1, 'Reading text…');
  const r1 = await Tesseract.recognize(b1, 'eng', {
    logger: m => { if (m.status === 'recognizing text') onProgress && onProgress(0.1 + m.progress * 0.55, `Reading text ${Math.round(m.progress*100)}%`); },
    tessedit_pageseg_mode: 6,
    preserve_interword_spaces: '1',
  });
  let text = r1.data.text;
  let parsed = parseReceipt(text);
  // Second pass if first was poor
  if (parsed.items.length < 2 && parsed.summary.total == null) {
    onProgress && onProgress(0.65, 'Enhanced pass…');
    const canvas2 = preprocessImage(img, { maxDim: 2400, minDim: 1800, threshold: true });
    const b2 = await canvasToBlob(canvas2);
    const r2 = await Tesseract.recognize(b2, 'eng', {
      logger: m => { if (m.status === 'recognizing text') onProgress && onProgress(0.65 + m.progress * 0.3, `Enhanced pass ${Math.round(m.progress*100)}%`); },
      tessedit_pageseg_mode: 4,
      preserve_interword_spaces: '1',
    });
    const p2 = parseReceipt(r2.data.text);
    if (p2.items.length > parsed.items.length || (p2.summary.total != null && parsed.summary.total == null)) {
      text = r2.data.text; parsed = p2;
    }
  }
  return text;
}

// Handle multiple files: each becomes its own receipt
async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (files.length === 0) return;
  ensureReceipt();

  // If there's only one file and the active receipt is empty, keep current behaviour.
  // Otherwise create a fresh receipt per file.
  const active = activeReceipt();
  const useCurrent = files.length === 1 && active && active.items.length === 0 && (!active.tax || active.tax === 0) && (!active.tip || active.tip === 0);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let target = null;
    if (i === 0 && useCurrent) {
      target = active;
      if (files.length === 1) target.label = f.name.replace(/\.[^.]+$/, '').slice(0, 30) || target.label;
    } else {
      target = makeReceipt(f.name.replace(/\.[^.]+$/, '').slice(0, 30) || `Receipt ${state.receipts.length + 1}`);
      state.receipts.push(target);
    }
    state.activeReceiptId = target.id;
    syncTaxTipInputs();
    render();
    await handleFile(f, target.id, { index: i, total: files.length });
  }
  // Clear the file input so the same file can be re-selected later
  try { document.getElementById('libraryInput').value = ''; } catch(e){}
  try { document.getElementById('cameraInput').value = ''; } catch(e){}
}

async function handleFile(file, receiptId, batchInfo) {
  if (!file) return;
  const targetReceipt = receiptId
    ? state.receipts.find(r => r.id === receiptId)
    : activeReceipt();
  const progEl = document.getElementById('ocrProgress');
  const bar = document.getElementById('ocrBar');
  const status = document.getElementById('ocrStatus');
  const previewEl = document.getElementById('previewImg');
  progEl.style.display = '';
  bar.style.width = '0%';
  status.textContent = 'Reading photo…';

  const useCloud = document.getElementById('cloudOcrToggle').checked;

  try {
    // Convert HEIC if needed
    let blob = file;
    const isHeic = (file.type || '').toLowerCase().includes('heic') ||
                   (file.name || '').toLowerCase().match(/\.heic$|\.heif$/);
    if (isHeic) {
      status.textContent = 'Converting HEIC photo…';
      blob = await ensureWebFormat(file);
    }
    previewEl.src = URL.createObjectURL(blob);
    previewEl.style.display = '';

    // Resize for cloud upload (OCR.space has 1MB limit on free tier)
    if (useCloud) {
      const img = await loadImage(blob);
      const canvas = preprocessImage(img, { maxDim: 1500, minDim: 1000, threshold: false });
      blob = await canvasToBlob(canvas);
      previewEl.src = URL.createObjectURL(blob);
    }

    const onProgress = (frac, msg) => {
      bar.style.width = Math.round(frac * 100) + '%';
      if (msg) status.textContent = msg;
    };

    let text = '';
    try {
      if (useCloud) {
        text = await cloudOCR(blob, onProgress);
      } else {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract not loaded');
        text = await localOCR(blob, onProgress);
      }
    } catch (primaryErr) {
      console.warn('Primary OCR failed', primaryErr);
      status.textContent = (useCloud ? 'Cloud' : 'Local') + ' OCR failed — trying the other engine…';
      if (useCloud) {
        if (typeof Tesseract !== 'undefined') text = await localOCR(blob, onProgress);
        else throw primaryErr;
      } else {
        text = await cloudOCR(blob, onProgress);
      }
    }

    bar.style.width = '100%';
    const parsed = parseReceipt(text);
    const batch = batchInfo && batchInfo.total > 1;
    const rId = targetReceipt ? targetReceipt.id : (activeReceipt() && activeReceipt().id);

    if (batch) {
      // Multi-file mode: auto-add items directly to this file's receipt, skip preview UI
      parsed.items.forEach(it => addItem(it.name, it.price, rId));
      applyDetectedTotals(parsed.summary, rId);
      // Clear the OCR preview box
      const oc = document.getElementById('ocrResult');
      if (oc) oc.innerHTML = '';
    } else {
      showOCRResult(text, parsed.items, parsed.summary, parsed.confidence);
      applyDetectedTotals(parsed.summary, rId);
    }

    const bits = [];
    if (parsed.summary.tax != null) bits.push(`tax ${fmt(parsed.summary.tax)}`);
    if (parsed.summary.tip != null) bits.push(`tip ${fmt(parsed.summary.tip)}`);
    const batchPrefix = batch ? `[${batchInfo.index + 1}/${batchInfo.total}] ` : '';
    if (parsed.items.length === 0 && parsed.summary.total == null) {
      status.textContent = `${batchPrefix}Couldn't read this photo well.` + (batch ? '' : ' Try the tips above ↑ or add items manually.');
    } else {
      const confMsg = parsed.confidence === 'low' ? ' · ⚠️ please review' :
                      parsed.confidence === 'medium' ? ' · double-check values' : '';
      status.textContent = `${batchPrefix}Found ${parsed.items.length} item(s)` +
        (bits.length ? ` · auto-filled ${bits.join(' & ')}` : '') + confMsg + '.';
    }
  } catch (err) {
    console.error(err);
    const batchPrefix = batchInfo && batchInfo.total > 1 ? `[${batchInfo.index + 1}/${batchInfo.total}] ` : '';
    status.textContent = `${batchPrefix}Error: ` + err.message;
  }
}

function parseReceipt(text) {
  // Clean up common OCR artifacts
  text = text.replace(/[|''`]/g, "'").replace(/[""]/g, '"');
  // Fix common OCR errors in numbers: "O" -> "0" inside number context
  text = text.replace(/(\d)[Oo](\d)/g, '$10$2');
  const rawLines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const summary = { subtotal: null, tax: null, tip: null, total: null };

  // ---- Regexes ----
  const priceRe = /(?:^|[\s\$£€¥฿₩])(\d{1,4}(?:[.,]\d{2}))\s*$/;
  const priceAnywhereRe = /(?:[\$£€¥฿₩])\s*(\d{1,4}(?:[.,]\d{2}))/;

  const subtotalRe = /\b(sub[\s\-]?total|purchase\s+subtotal)\b/i;
  const taxRe = /\b(tax|vat|gst|hst|sales\s*tax|nyc?\s*tax|new\s*york\s*tax)\b(?!\s*percent|\s*\%)/i;
  const tipOnlyRe = /^(tip|gratuity|service\s*charge|\+\s*tip)\b/i; // "Tip" at line start
  const totalRe = /\b(total|grand\s*total|amount\s*due)\b(?!.*tip)/i;

  // Anything starting with these words means "this is not an item line"
  const boilerplateRe = /^(check\s*#|table\b|server\b|ordered\b|guest\b|date\b|time\b|receipt\b|invoice\b|thank\b|interested\b|contact\b|suggested\b|tip\s*percent|price\s*before|change\b|cash\b|visa\b|mastercard\b|amex\b|american\s*express|discover\b|debit\b|credit\s*card|paid\b|due\b|balance\b|amount\b|---+|====+|street\b|avenue\b|road\b|address\b|phone\b|tel\b|fax\b|www|http|@|application\b|approval\b|authoriz|transaction\b|payment\s*id|batch\b|auth\s*code|card\s*reader|merchant\b|contactless\b|sale\b|approved\b|customer\s*copy|merchant\s*copy|x{3,}|\*{3,}|f\d{5}|80pos|88pos|a0{6,}|cwkp|acadia\b)/i;
  // Also reject lines whose content obviously contains card / auth jargon (not just at start)
  const insideBoilerRe = /\b(application\s*label|application\s*id|approval\s*code|card\s*reader|transaction\s*type|payment\s*id|authorization)\b/i;

  // Percentage tip line: "20%: ($18.20 Total $117.27)" or "22% (Tip $20.02 ...)"
  // Also catch malformed OCR like "%: (Tip 18.20" where the digits got dropped
  const pctTipLineRe = /^\s*\(?\d{1,3}?\s*%[\s:(]|^\s*%\s*[:(]|\(\s*tip\b/i;
  // Lines that mark the boundary AFTER items finish — only include markers
  // that reliably appear POST-items, not pre-items. Things like masked card
  // numbers (XXX5299) and "Mastercard" can appear in the header too, so they
  // are handled via per-line skipping instead.
  const itemEndMarkers = /(sub[\s\-]?total|\bgrand\s*total\b|\btotal\s*\$?\s*\d|suggested\s*tip|tip\s*percentage|based\s*on\s*the\s*check|customer\s*copy|merchant\s*copy|thank\s*you\s*(for|!)|application\s*label|approval\s*code)/i;

  // ---- Find where the item section ends ----
  // Prefer the FIRST occurrence of "Subtotal" since that's the most reliable marker.
  // If no Subtotal found, fall back to other markers; otherwise consider all lines.
  let itemEndIdx = rawLines.length;
  // First look for Subtotal specifically
  for (let i = 0; i < rawLines.length; i++) {
    if (subtotalRe.test(rawLines[i])) { itemEndIdx = i; break; }
  }
  // If Subtotal wasn't found, use the broader itemEndMarkers
  if (itemEndIdx === rawLines.length) {
    for (let i = 0; i < rawLines.length; i++) {
      if (itemEndMarkers.test(rawLines[i])) { itemEndIdx = i; break; }
    }
  }

  // ---- First pass: extract summary values from ANYWHERE in the text ----
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // Skip the "Suggested Tip" percentage section entirely for summary extraction
    if (pctTipLineRe.test(line)) continue;

    let m = line.match(priceRe);
    if (!m) m = line.match(priceAnywhereRe);
    if (!m) continue;
    const price = parseFloat(m[1].replace(',', '.'));
    if (isNaN(price) || price <= 0 || price > 99999) continue;

    let label = line.slice(0, m.index).replace(/[\$£€¥฿₩]/g, '').trim().replace(/\s+/g, ' ');

    if (subtotalRe.test(label) && summary.subtotal == null) { summary.subtotal = price; }
    else if (taxRe.test(label) && summary.tax == null) {
      // Allow "Tax 8.875% 2.89" style — the % is a rate, the price is the amount.
      // Only skip if the label is ONLY a rate (no separate dollar amount) — but since
      // we already have a captured price, any taxRe match should count.
      summary.tax = price;
    }
    else if (tipOnlyRe.test(label) && !/suggested|percent/i.test(label) && summary.tip == null) { summary.tip = price; }
    else if (totalRe.test(label) && !/suggested|percent|tip\s*\$/i.test(label) && summary.total == null) { summary.total = price; }
  }

  // Fallback: if we didn't find subtotal but found tax + total, derive it
  if (summary.subtotal == null && summary.tax != null && summary.total != null) {
    const derived = summary.total - summary.tax - (summary.tip || 0);
    if (derived > 0) summary.subtotal = +derived.toFixed(2);
  }

  // Sanity check tip: tip should be less than subtotal (if known).
  // A common OCR failure is reading "+ Tip: $117.27" where $117.27 is actually the total.
  if (summary.tip != null && summary.subtotal != null && summary.tip > summary.subtotal * 0.6) {
    // Tip > 60% of subtotal is implausible — probably misread as the total
    if (summary.total == null) summary.total = summary.tip;
    summary.tip = null;
  }

  // ---- Helper: split a line that merges multiple items into one ----
  // e.g. "1 Iced Cappuccino 1 Double Capuccino $46.00" → 2 items
  //      "Americano 1 Potato Latkes 91.00 $8.07"       → 2 items
  // Strategy: find all "qty + CapitalizedWord" boundaries within the label part.
  // The last chunk keeps the trailing price; earlier chunks get price = 0 (user edits).
  function splitMergedLabel(label, trailingPrice) {
    // Also detect mid-line prices that belong to earlier chunks
    // Look for pattern: label-text <price> label-text (embedded prices)
    // Split points: spaces followed by "digit(s) + space + Capital letter"
    const splitPts = [];
    const splitRe = /\s(?=\d+\s+[A-Z][a-z])/g;
    let m;
    while ((m = splitRe.exec(label)) !== null) {
      if (m.index > 2) splitPts.push(m.index);
    }
    if (splitPts.length === 0) return [{ name: label, price: trailingPrice }];

    const parts = [];
    let start = 0;
    for (const pt of splitPts) {
      parts.push(label.slice(start, pt).trim());
      start = pt + 1;
    }
    parts.push(label.slice(start).trim());

    // Also scan each part for an embedded price (digits.digits, no $)
    const embeddedPriceRe = /\s(\d{1,3}[.,]\d{2})\s*$/;
    const result = parts.map((p, idx) => {
      const em = p.match(embeddedPriceRe);
      if (em) {
        const embPrice = parseFloat(em[1].replace(',', '.'));
        const cleanName = p.slice(0, em.index).trim();
        return { name: cleanName, price: embPrice };
      }
      // Last part gets the trailing price; others get 0 (user will edit)
      return { name: p, price: idx === parts.length - 1 ? trailingPrice : 0 };
    });
    return result;
  }

  // ---- Detect orphan summary labels (on their own lines, no value) ----
  // If we see "Subtotal" / "Tax" / "Total" on a line with no price, any nearby
  // bare-number line is probably that summary value — not an item price.
  const orphanSummaryPrices = new Set();
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const hasPrice = priceRe.test(line) || priceAnywhereRe.test(line);
    if (hasPrice) continue;
    if (!(subtotalRe.test(line) || taxRe.test(line) || totalRe.test(line) || tipOnlyRe.test(line))) continue;
    // Look at the next 2 lines for a bare numeric value
    for (let j = i + 1; j < Math.min(i + 3, rawLines.length); j++) {
      const bare = rawLines[j].match(/^\s*\$?\s*(\d{1,4}[.,]\d{2})\s*$/);
      if (bare) {
        const p = parseFloat(bare[1].replace(',', '.'));
        if (!isNaN(p) && p > 0) orphanSummaryPrices.add(+p.toFixed(2));
        break;
      }
    }
  }

  // ---- Second pass: extract items ONLY from the item section ----
  const rawItems = [];
  for (let i = 0; i < itemEndIdx; i++) {
    const line = rawLines[i];

    // Hard skips
    if (boilerplateRe.test(line)) continue;
    if (insideBoilerRe.test(line)) continue;
    if (pctTipLineRe.test(line)) continue;
    if (/x{3,}\d|x{4,}/i.test(line)) continue;
    if (/\d{2}:\d{2}\s*(am|pm)?/i.test(line)) continue; // times
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue; // dates

    let m = line.match(priceRe);
    if (!m) m = line.match(priceAnywhereRe);
    if (!m) continue;
    const price = parseFloat(m[1].replace(',', '.'));
    if (isNaN(price) || price <= 0 || price > 9999) continue;

    let label = line.slice(0, m.index).replace(/[\$£€¥฿₩]/g, '').trim().replace(/\s+/g, ' ');

    // Skip summary lines
    if (subtotalRe.test(label) || taxRe.test(label) || tipOnlyRe.test(label) || totalRe.test(label)) continue;

    // Split multi-item merged lines BEFORE the strict name sanitisation
    const pieces = splitMergedLabel(label, price);

    for (const piece of pieces) {
      // Strip leading qty like "2x", "1 x", "2 ", "(2)"
      let name = piece.name.replace(/^\(?\s*\d+\s*\)?\s*[xX]?\s*/, '').trim();
      // Strip trailing qty "1 Iced Cappuccino 1"
      name = name.replace(/\s+\d+\s*$/, '').trim();
      // Strip leading punctuation
      name = name.replace(/^[%:()\s\-_.]+/, '').trim();
      if (!name || name.length < 3) continue;

      const letters = (name.match(/[a-zA-Z]/g) || []).length;
      const digits = (name.match(/\d/g) || []).length;
      if (letters < 3) continue;
      if (letters / name.length < 0.4) continue;
      if (digits > letters) continue;
      if (/\d{3}[\-\s]\d{3,4}/.test(name)) continue;

      // Reject names that contain obvious boilerplate words
      if (/\b(application|approval|authorization|transaction|payment\s*id|card\s*reader|batch|approved|mastercard|visa|amex|contactless|customer\s*copy|merchant\s*copy|tip\b|gratuity|suggested)\b/i.test(name)) continue;
      // Reject if contains a % sign (pct tip line that slipped through)
      if (/%/.test(name)) continue;

      // Reject if the price matches an orphan-summary value
      if (piece.price > 0 && orphanSummaryPrices.has(+piece.price.toFixed(2))) continue;

      rawItems.push({ name, price: piece.price });
    }
  }

  // ---- Filter: drop items whose price matches a known summary figure ----
  // Keep items with price == 0 (split-item placeholders — user will edit the price)
  const summaryVals = [summary.subtotal, summary.tax, summary.tip, summary.total].filter(v => v != null);
  let items = rawItems.filter(it => it.price === 0 || !summaryVals.some(v => Math.abs(it.price - v) < 0.01));

  // ---- Sanity check against subtotal ----
  if (summary.subtotal != null && items.length) {
    // ALWAYS drop items priced >= 98% of subtotal — they're almost certainly the
    // total/auth amount mis-classified as an item. Better to show nothing than wrong values.
    items = items.filter(it => it.price < summary.subtotal * 0.98);

    // If item sum still wildly exceeds subtotal, keep only cheapest items whose sum ≤ subtotal * 1.1
    const sum = items.reduce((s, it) => s + it.price, 0);
    if (sum > summary.subtotal * 1.4 && items.length > 1) {
      const sorted = [...items].sort((a, b) => a.price - b.price);
      const kept = [];
      let running = 0;
      for (const it of sorted) {
        // Zero-priced split items always kept (placeholders)
        if (it.price === 0) { kept.push(it); continue; }
        if (running + it.price <= summary.subtotal * 1.1) { kept.push(it); running += it.price; }
      }
      items = kept;
    }
  }

  // ---- De-duplicate ----
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const key = it.name.toLowerCase().replace(/\s+/g, '') + '_' + it.price.toFixed(2);
    if (!seen.has(key)) { seen.add(key); dedup.push(it); }
  }

  // ---- Confidence flag ----
  // If any item has price 0 (split placeholder awaiting user input), confidence is low
  const hasZeroPriced = dedup.some(it => it.price === 0);
  let confidence = 'high';
  if (dedup.length === 0) confidence = 'none';
  else if (hasZeroPriced) confidence = 'low';
  else if (summary.subtotal != null) {
    const sum = dedup.reduce((s, it) => s + it.price, 0);
    const diff = Math.abs(sum - summary.subtotal);
    if (diff > summary.subtotal * 0.15) confidence = 'low';
    else if (diff > summary.subtotal * 0.05) confidence = 'medium';
  } else if (dedup.length < 2) {
    confidence = 'low';
  }

  return { items: dedup, summary, confidence };
}

function applyDetectedTotals(summary, receiptId) {
  const target = receiptId
    ? state.receipts.find(r => r.id === receiptId)
    : activeReceipt();
  if (!target) return;
  if (summary.tax != null && (!target.tax || target.tax === 0)) target.tax = +summary.tax;
  if (summary.tip != null && (!target.tip || target.tip === 0)) target.tip = +summary.tip;
  syncTaxTipInputs();
  render();
}

function showOCRResult(rawText, items, summary, confidence) {
  const el = document.getElementById('ocrResult');
  let summaryHtml = '';
  if (summary && (summary.subtotal != null || summary.tax != null || summary.tip != null || summary.total != null)) {
    const rows = [];
    if (summary.subtotal != null) rows.push(`<div class="row-line"><span>Subtotal</span><span>${fmt(summary.subtotal)}</span></div>`);
    if (summary.tax != null) rows.push(`<div class="row-line found"><span>Tax <span class="check">✓ auto-filled</span></span><span>${fmt(summary.tax)}</span></div>`);
    if (summary.tip != null) rows.push(`<div class="row-line found"><span>Tip <span class="check">✓ auto-filled</span></span><span>${fmt(summary.tip)}</span></div>`);
    if (summary.total != null) rows.push(`<div class="row-line"><span>Total</span><span>${fmt(summary.total)}</span></div>`);
    summaryHtml = `<div class="detected-summary"><div class="head">📋 Receipt summary</div>${rows.join('')}</div>`;
  }

  // Confidence warning
  let warningHtml = '';
  if (confidence === 'low') {
    const itemSum = items.reduce((s, it) => s + it.price, 0);
    const expected = summary && summary.subtotal != null ? ` (expected ~${fmt(summary.subtotal)})` : '';
    warningHtml = `<div class="ocr-warn">⚠️ <strong>Low confidence</strong> — items sum to ${fmt(itemSum)}${expected}. Please review prices below or <a href="#" onclick="clearOCRItems();return false;">clear &amp; enter manually</a>.</div>`;
  } else if (confidence === 'medium') {
    warningHtml = `<div class="ocr-warn medium">ℹ️ Some values may need adjusting — double-check before adding.</div>`;
  }

  if (items.length === 0) {
    el.innerHTML = summaryHtml + warningHtml +
      `<div class="hint" style="margin-top:10px;text-align:center;">No items detected. Add them manually below ↓</div>` +
      `<details class="raw" ${items.length === 0 ? 'open' : ''}>
        <summary>✏️ Show / edit raw OCR text</summary>
        <div class="hint" style="margin:6px 0;">Edit this text and hit <em>Re-parse</em> to re-run detection — useful when OCR was mostly right but missed a line.</div>
        <textarea id="rawOcrText" class="raw-edit" spellcheck="false">${escapeHtml(rawText)}</textarea>
        <button class="btn sm" style="margin-top:6px;" onclick="reparseOCR()">↻ Re-parse</button>
      </details>`;
    return;
  }
  el.innerHTML = summaryHtml + warningHtml + `
    <div style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
        <strong style="font-size:13px;">Detected items (${items.length})</strong>
        <div style="display:flex;gap:6px;">
          <button class="btn sm secondary" onclick="clearOCRItems()" style="padding:4px 10px;font-size:12px;">Clear</button>
          <button class="btn sm" onclick="addAllOCRItems()">Add all →</button>
        </div>
      </div>
      <div id="ocrItems"></div>
      <details class="raw" style="margin-top:8px;"><summary>Show raw OCR text</summary><pre>${escapeHtml(rawText)}</pre></details>
    </div>`;
  const container = document.getElementById('ocrItems');
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'ocr-item';
    row.innerHTML = `
      <input type="text" class="name" value="${escapeHtml(it.name)}" data-i="${idx}" data-f="name" />
      <input type="number" class="price" value="${it.price.toFixed(2)}" step="0.01" min="0" inputmode="decimal" data-i="${idx}" data-f="price" />
      <button class="btn secondary" data-i="${idx}">Add</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      if (f === 'price') items[i].price = parseFloat(e.target.value) || 0;
      else items[i][f] = e.target.value;
    });
  });
  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.target.dataset.i;
      addItem(items[i].name, items[i].price);
      toast('Added: ' + items[i].name);
    });
  });
}

function reparseOCR() {
  const ta = document.getElementById('rawOcrText');
  if (!ta) return;
  const text = ta.value;
  const parsed = parseReceipt(text);
  showOCRResult(text, parsed.items, parsed.summary, parsed.confidence);
  applyDetectedTotals(parsed.summary);
  const status = document.getElementById('ocrStatus');
  if (status) {
    const bits = [];
    if (parsed.summary.tax != null) bits.push('tax ' + fmt(parsed.summary.tax));
    if (parsed.summary.tip != null) bits.push('tip ' + fmt(parsed.summary.tip));
    status.textContent = 'Re-parsed: found ' + parsed.items.length + ' item(s)' +
      (bits.length ? ' · ' + bits.join(' & ') : '') + '.';
  }
  toast('Re-parsed');
}

function clearOCRItems() {
  const el = document.getElementById('ocrResult');
  if (el) el.innerHTML = '';
  const status = document.getElementById('ocrStatus');
  if (status) status.textContent = 'Cleared. Add items manually below, or retake the photo.';
}

function addAllOCRItems() {
  const inputs = document.querySelectorAll('#ocrItems .ocr-item');
  let count = 0;
  inputs.forEach(row => {
    const name = row.querySelector('input.name').value.trim();
    const price = parseFloat(row.querySelector('input.price').value);
    if (name && !isNaN(price) && price > 0) { addItem(name, price); count++; }
  });
  toast(`Added ${count} item${count===1?'':'s'}`);
}

// ---------- Events ----------
document.getElementById('personName').addEventListener('keydown', e => { if (e.key === 'Enter') addPerson(); });
document.getElementById('itemName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('itemPrice').focus(); });
document.getElementById('itemPrice').addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

const ua = document.getElementById('uploadArea');
['dragover','dragenter'].forEach(ev => ua.addEventListener(ev, e => { e.preventDefault(); ua.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => ua.addEventListener(ev, e => { e.preventDefault(); ua.classList.remove('drag'); }));
ua.addEventListener('drop', e => { const files = e.dataTransfer.files; if (files && files.length) handleFiles(files); });

render();
initLiff();
