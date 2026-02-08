// Main Application Logic
import './firebaseConfig.js';

// Configuration
const defaultConfig = {
  business_name: 'Sistema de Inventario',
  currency_symbol: '$'
};

let config = { ...defaultConfig };
let allData = [];
let products = [];
let movements = [];
let shrinkages = [];
let moneyRecords = [];
let isLoading = false;
let isTestUser = false; // Flag para usuario de prueba

// Variables para Servicios
let services = JSON.parse(localStorage.getItem('inventario_services')) || [];

// Palabras aleatorias para verificación
const verificationWords = [
  'CONFIRMAR', 'ELIMINAR', 'PELIGRO', 'ADVERTENCIA', 'BORRAR',
  'DESTRUIR', 'LIMPIAR', 'FINALIZAR', 'TERMINAR', 'ACABAR'
];

// Firebase references
let dbRef;
let productsRef;
let movementsRef;
let shrinkagesRef;
let moneyRef;

function saveServices() {
  localStorage.setItem('inventario_services', JSON.stringify(services));
}

function initFirebase() {
  if (!window.firebaseDB) {
    console.error('Firebase no está cargado');
    return false;
  }
  
  const { ref, database } = window.firebaseDB;
  dbRef = ref(database, 'inventario');
  productsRef = ref(database, 'inventario/products');
  movementsRef = ref(database, 'inventario/movements');
  shrinkagesRef = ref(database, 'inventario/shrinkages');
  moneyRef = ref(database, 'inventario/money');
  
  return true;
}

function formatCLP(amount) {
  return config.currency_symbol + new Intl.NumberFormat('es-CL').format(Math.round(amount || 0));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-CL');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showConfirm(title, message, verificationRequired = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const verificationFields = document.getElementById('verificationFields');
    verificationFields.innerHTML = '';
    
    if (verificationRequired) {
      const today = new Date().toISOString().split('T')[0];
      const randomWord = verificationWords[Math.floor(Math.random() * verificationWords.length)];
      
      verificationFields.innerHTML = `
        <div>
          <label class="block text-sm text-gray-400 mb-1">Escribe la fecha de hoy (${today})</label>
          <input type="text" id="inputTodayDate" class="w-full input-glass rounded-lg px-4 py-2">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Escribe la palabra: <strong class="text-yellow-400">${randomWord}</strong></label>
          <input type="text" id="inputRandomWord" class="w-full input-glass rounded-lg px-4 py-2">
        </div>
      `;
      
      modal.dataset.correctDate = today;
      modal.dataset.correctWord = randomWord;
    }
    
    modal.classList.remove('hidden');
    
    const handleOk = () => {
      if (verificationRequired) {
        const inputDate = document.getElementById('inputTodayDate').value;
        const inputWord = document.getElementById('inputRandomWord').value.toUpperCase();
        const correctDate = modal.dataset.correctDate;
        const correctWord = modal.dataset.correctWord;
        
        if (inputDate !== correctDate || inputWord !== correctWord) {
          showToast('Verificación incorrecta', 'error');
          return;
        }
      }
      
      modal.classList.add('hidden');
      cleanup();
      resolve(true);
    };
    
    const handleCancel = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(false);
    };
    
    const cleanup = () => {
      document.getElementById('confirmOk').removeEventListener('click', handleOk);
      document.getElementById('confirmCancel').removeEventListener('click', handleCancel);
      delete modal.dataset.correctDate;
      delete modal.dataset.correctWord;
    };
    
    document.getElementById('confirmOk').addEventListener('click', handleOk);
    document.getElementById('confirmCancel').addEventListener('click', handleCancel);
  });
}

function disableEditingForTestUser() {
  if (!isTestUser) return;
  
  // Desabilitar botones de agregar/editar/eliminar
  const createButtons = document.querySelectorAll('[id*="Btn"]:not(#menuBtn):not(#closeMenu)');
  createButtons.forEach(btn => {
    btn.classList.add('btn-disabled');
    btn.disabled = true;
    btn.title = 'No disponible para usuario de prueba';
  });
  
  // Desabilitar formularios
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.disabled = true;
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('btn-disabled');
    }
  });
  
  // Mostrar indicador visual
  const header = document.querySelector('header');
  if (header) {
    const badge = document.createElement('div');
    badge.className = 'px-3 py-1 bg-orange-500/30 text-orange-400 rounded-lg text-sm font-medium';
    badge.textContent = '🔒 Modo Visualización';
    header.appendChild(badge);
  }
}

function parseData() {
  products = allData.filter(d => d.type === 'product');
  movements = allData.filter(d => d.type === 'movement');
  shrinkages = allData.filter(d => d.type === 'shrinkage');
  moneyRecords = allData.filter(d => d.type === 'money');
}

function getDateRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to;
  
  switch(period) {
    case 'daily':
      from = today;
      to = today;
      break;
    case 'weekly':
      from = new Date(today);
      from.setDate(today.getDate() - 7);
      to = today;
      break;
    case 'monthly':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = today;
      break;
    default:
      from = null;
      to = null;
  }
  return { from, to };
}

function filterByDate(items, dateField, fromDate, toDate) {
  if (!fromDate && !toDate) return items;
  return items.filter(item => {
    const itemDate = new Date(item[dateField]);
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    if (from) from.setHours(0, 0, 0, 0);
    if (to) to.setHours(23, 59, 59, 999);
    if (from && to) return itemDate >= from && itemDate <= to;
    if (from) return itemDate >= from;
    if (to) return itemDate <= to;
    return true;
  });
}

async function loadFirebaseData() {
  if (!initFirebase()) {
    showToast('Error al conectar con Firebase', 'error');
    return;
  }

  const { onValue, ref, database } = window.firebaseDB;
  
  const allDataRef = ref(database, 'inventario');
  onValue(allDataRef, (snapshot) => {
    allData = [];
    const data = snapshot.val();
    
    if (data) {
      if (data.products) {
        Object.keys(data.products).forEach(key => {
          allData.push({
            __backendId: key,
            id: key,
            ...data.products[key],
            type: 'product'
          });
        });
      }
      
      if (data.movements) {
        Object.keys(data.movements).forEach(key => {
          allData.push({
            __backendId: key,
            id: key,
            ...data.movements[key],
            type: 'movement'
          });
        });
      }
      
      if (data.shrinkages) {
        Object.keys(data.shrinkages).forEach(key => {
          allData.push({
            __backendId: key,
            id: key,
            ...data.shrinkages[key],
            type: 'shrinkage'
          });
        });
      }
      
      if (data.money) {
        Object.keys(data.money).forEach(key => {
          allData.push({
            __backendId: key,
            id: key,
            ...data.money[key],
            type: 'money'
          });
        });
      }
    }
    
    parseData();
    renderAll();
    disableEditingForTestUser();
  }, (error) => {
    showToast('Error al cargar datos: ' + error.message, 'error');
  });
}

// Firebase CRUD operations
async function createItem(type, data) {
  if (!initFirebase()) return { isOk: false };
  
  const { push, ref, set, database } = window.firebaseDB;
  try {
    const itemRef = ref(database, `inventario/${type}`);
    const newItemRef = push(itemRef);
    await set(newItemRef, data);
    return { isOk: true, id: newItemRef.key };
  } catch (error) {
    console.error('Error creating item:', error);
    return { isOk: false, error };
  }
}

async function updateItem(type, id, data) {
  if (!initFirebase()) return { isOk: false };
  
  const { ref, set, database } = window.firebaseDB;
  try {
    const itemRef = ref(database, `inventario/${type}/${id}`);
    await set(itemRef, data);
    return { isOk: true };
  } catch (error) {
    console.error('Error updating item:', error);
    return { isOk: false, error };
  }
}

async function deleteItem(type, id) {
  if (!initFirebase()) return { isOk: false };
  
  const { ref, remove, database } = window.firebaseDB;
  try {
    const itemRef = ref(database, `inventario/${type}/${id}`);
    await remove(itemRef);
    return { isOk: true };
  } catch (error) {
    console.error('Error deleting item:', error);
    return { isOk: false, error };
  }
}

function renderAll() {
  renderDashboard();
  renderProducts();
  renderMovements();
  renderShrinkages();
  renderMoney();
  renderServices();
  updateProductSelects();
  updateCategoryFilter();
}

function renderServices() {
  const container = document.getElementById('servicesList');
  
  if (services.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No hay servicios registrados</p>';
    return;
  }
  
  container.innerHTML = services.map((service, index) => {
    const dueDate = service.dueDate ? formatDate(service.dueDate) : 'Sin fecha';
    const isOverdue = service.dueDate && new Date(service.dueDate) < new Date();
    
    return `
      <div class="glass rounded-xl p-3 flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <p class="font-medium">${service.name}</p>
            ${isOverdue ? '<span class="px-2 py-0.5 bg-red-500/30 text-red-400 text-xs rounded-full">Vencido</span>' : ''}
          </div>
          <p class="text-sm text-gray-400">Vence: ${dueDate}</p>
        </div>
        <div class="text-right">
          <p class="text-yellow-400 font-bold">${formatCLP(service.amount)}</p>
          <div class="flex gap-2 mt-1">
            <button onclick="payService(${index})" class="text-xs text-green-400 hover:text-green-300 px-2 py-1 glass rounded" title="Marcar como pagado">
              Pagar
            </button>
            <button onclick="deleteService(${index})" class="text-xs text-red-400 hover:text-red-300" title="Eliminar">
              Eliminar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.payService = function(index) {
  if (isTestUser) {
    showToast('No puedes realizar esta acción en modo visualización', 'error');
    return;
  }
  
  if (index >= 0 && index < services.length) {
    const service = services[index];
    
    const moneyRecord = {
      moneyType: 'salida',
      amount: service.amount,
      description: `Pago de servicio: ${service.name}`,
      reference: `Servicio-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      type: 'money'
    };
    
    moneyRecords.push(moneyRecord);
    
    createItem('money', {
      moneyType: moneyRecord.moneyType,
      amount: moneyRecord.amount,
      description: moneyRecord.description,
      reference: moneyRecord.reference,
      date: moneyRecord.date,
      createdAt: moneyRecord.createdAt
    }).then(result => {
      if (result.isOk) {
        services.splice(index, 1);
        saveServices();
        renderServices();
        renderMoney();
        renderDashboard();
        
        showToast(`Servicio "${service.name}" marcado como pagado`);
      }
    });
  }
};

window.deleteService = function(index) {
  if (isTestUser) {
    showToast('No puedes eliminar servicios en modo visualización', 'error');
    return;
  }
  
  if (index >= 0 && index < services.length) {
    const serviceName = services[index].name;
    showConfirm('Eliminar Servicio', `¿Eliminar el servicio "${serviceName}"?`).then(confirmed => {
      if (confirmed) {
        services.splice(index, 1);
        saveServices();
        renderServices();
        showToast('Servicio eliminado');
      }
    });
  }
};

function renderDashboard() {
  const fromDate = document.getElementById('dashDateFrom').value;
  const toDate = document.getElementById('dashDateTo').value;
  
  document.getElementById('statProducts').textContent = products.length;
  
  const filteredMoney = filterByDate(moneyRecords, 'date', fromDate, toDate);
  const totalIncome = filteredMoney.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0);
  const totalExpense = filteredMoney.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0);
  
  document.getElementById('statIncome').textContent = formatCLP(totalIncome);
  document.getElementById('statExpense').textContent = formatCLP(totalExpense);
  
  const filteredShrinkages = filterByDate(shrinkages, 'date', fromDate, toDate);
  const totalShrinkage = filteredShrinkages.reduce((sum, s) => sum + (s.total || 0), 0);
  document.getElementById('statShrinkage').textContent = formatCLP(totalShrinkage);
  
  const balance = totalIncome - totalExpense;
  const balanceEl = document.getElementById('statBalance');
  balanceEl.textContent = formatCLP(balance);
  balanceEl.className = `text-3xl font-bold ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`;
  
  const inventoryValue = products.reduce((sum, p) => sum + ((p.cost || p.price || 0) * (p.stock || 0)), 0);
  document.getElementById('statInventoryValue').textContent = formatCLP(inventoryValue);
  
  const lowStockCount = products.filter(p => (p.stock || 0) <= (p.minStock || 5)).length;
  document.getElementById('statLowStock').textContent = lowStockCount;
  
  const recentContainer = document.getElementById('recentMovements');
  const recentItems = [...movements, ...shrinkages, ...moneyRecords]
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
    .slice(0, 5);
  
  if (recentItems.length === 0) {
    recentContainer.innerHTML = '<p class="text-gray-400 text-center py-4">Sin movimientos recientes</p>';
  } else {
    recentContainer.innerHTML = recentItems.map(item => {
      const product = products.find(p => p.id === item.productId);
      let icon, color, text, amount;
      
      if (item.type === 'movement') {
        icon = item.movementType === 'entrada' ? '📥' : '📤';
        color = item.movementType === 'entrada' ? 'text-green-400' : 'text-red-400';
        text = `${item.movementType === 'entrada' ? 'Entrada' : 'Salida'}: ${product?.name || 'Producto'} (${item.quantity})`;
        amount = '';
      } else if (item.type === 'shrinkage') {
        icon = '⚠️';
        color = 'text-yellow-400';
        text = `Merma: ${product?.name || 'Producto'} (${item.quantity})`;
        amount = formatCLP(item.total);
      } else {
        icon = item.moneyType === 'ingreso' ? '💰' : '💸';
        color = item.moneyType === 'ingreso' ? 'text-green-400' : 'text-red-400';
        text = item.description;
        amount = formatCLP(item.amount);
      }
      
      return `
        <div class="glass rounded-lg p-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>${icon}</span>
            <div>
              <p class="text-sm ${color}">${text}</p>
              <p class="text-xs text-gray-400">${formatDate(item.date)}</p>
            </div>
          </div>
          ${amount ? `<span class="${color} font-medium">${amount}</span>` : ''}
        </div>
      `;
    }).join('');
  }
  
  const lowStockContainer = document.getElementById('lowStockList');
  const lowStockProducts = products.filter(p => (p.stock || 0) <= (p.minStock || 5));
  
  if (lowStockProducts.length === 0) {
    lowStockContainer.innerHTML = '<p class="text-gray-400 text-center py-4">Todos los productos tienen stock suficiente</p>';
  } else {
    lowStockContainer.innerHTML = lowStockProducts.map(p => `
      <div class="glass rounded-lg p-3 flex items-center justify-between">
        <div>
          <p class="font-medium">${p.name}</p>
          <p class="text-xs text-gray-400">${p.category || 'Sin categoría'}</p>
        </div>
        <div class="text-right">
          <p class="text-orange-400 font-bold">${p.stock || 0} ${p.unit || 'unidad'}</p>
          <p class="text-xs text-gray-400">Mín: ${p.minStock || 5}</p>
        </div>
      </div>
    `).join('');
  }
}

function renderProducts() {
  const container = document.getElementById('productsList');
  const search = document.getElementById('searchProduct').value.toLowerCase();
  const category = document.getElementById('filterCategory').value;
  
  let filtered = products;
  if (search) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(search) || 
      (p.sku && p.sku.toLowerCase().includes(search))
    );
  }
  if (category) {
    filtered = filtered.filter(p => p.category === category);
  }
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No hay productos registrados</p>';
    return;
  }
  
  container.innerHTML = filtered.map(p => {
    const isLow = (p.stock || 0) <= (p.minStock || 5);
    const editDeleteHTML = isTestUser 
      ? '' 
      : `<div class="flex gap-2">
          <button onclick="editProduct('${p.id}')" class="p-2 glass rounded-lg hover:bg-white/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button onclick="deleteProduct('${p.id}')" class="p-2 glass rounded-lg hover:bg-red-500/30 text-red-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>`;
    
    return `
      <div class="glass rounded-xl p-4" data-id="${p.id}">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h4 class="font-semibold">${p.name}</h4>
              ${isLow ? '<span class="px-2 py-0.5 bg-orange-500/30 text-orange-400 text-xs rounded-full">Stock bajo</span>' : ''}
            </div>
            <p class="text-sm text-gray-400">${p.category || 'Sin categoría'} ${p.sku ? '• ' + p.sku : ''}</p>
            <div class="flex items-center gap-4 mt-2 text-sm">
              <span class="text-green-400">${formatCLP(p.price)}</span>
              <span class="text-gray-400">Stock: <span class="${isLow ? 'text-orange-400' : 'text-white'}">${p.stock || 0}</span> ${p.unit || 'unidad'}</span>
            </div>
          </div>
          ${editDeleteHTML}
        </div>
      </div>
    `;
  }).join('');
}

function renderMovements() {
  const container = document.getElementById('movementsList');
  const fromDate = document.getElementById('movDateFrom').value;
  const toDate = document.getElementById('movDateTo').value;
  const typeFilter = document.getElementById('filterMovType').value;
  
  let filtered = filterByDate(movements, 'date', fromDate, toDate);
  if (typeFilter) {
    filtered = filtered.filter(m => m.movementType === typeFilter);
  }
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const entries = filtered.filter(m => m.movementType === 'entrada').reduce((sum, m) => sum + (m.quantity || 0), 0);
  const exits = filtered.filter(m => m.movementType === 'salida').reduce((sum, m) => sum + (m.quantity || 0), 0);
  
  document.getElementById('movEntriesTotal').textContent = entries;
  document.getElementById('movExitsTotal').textContent = exits;
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No hay movimientos registrados</p>';
    return;
  }
  
  container.innerHTML = filtered.map(m => {
    const product = products.find(p => p.id === m.productId);
    const isEntry = m.movementType === 'entrada';
    const deleteBtn = isTestUser 
      ? '' 
      : `<button onclick="deleteMovement('${m.id}')" class="text-xs text-gray-400 hover:text-red-400">Eliminar</button>`;
    
    return `
      <div class="glass rounded-xl p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg ${isEntry ? 'bg-green-500/30' : 'bg-red-500/30'} flex items-center justify-center">
            <svg class="w-5 h-5 ${isEntry ? 'text-green-400' : 'text-red-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isEntry ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}"/>
            </svg>
          </div>
          <div>
            <p class="font-medium">${product?.name || 'Producto eliminado'}</p>
            <p class="text-sm text-gray-400">${m.reason || 'Sin motivo'} • ${formatDate(m.date)}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="${isEntry ? 'text-green-400' : 'text-red-400'} font-bold">${isEntry ? '+' : '-'}${m.quantity}</p>
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function renderShrinkages() {
  const container = document.getElementById('shrinkageList');
  const fromDate = document.getElementById('shrinkDateFrom').value;
  const toDate = document.getElementById('shrinkDateTo').value;
  
  let filtered = filterByDate(shrinkages, 'date', fromDate, toDate);
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const total = filtered.reduce((sum, s) => sum + (s.total || 0), 0);
  document.getElementById('shrinkageTotal').textContent = formatCLP(total);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No hay mermas registradas</p>';
    return;
  }
  
  container.innerHTML = filtered.map(s => {
    const product = products.find(p => p.id === s.productId);
    const deleteBtn = isTestUser 
      ? '' 
      : `<button onclick="deleteShrinkage('${s.id}')" class="text-xs text-gray-400 hover:text-red-400">Eliminar</button>`;
    
    return `
      <div class="glass rounded-xl p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-yellow-500/30 flex items-center justify-center">
            <svg class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          <div>
            <p class="font-medium">${product?.name || 'Producto eliminado'}</p>
            <p class="text-sm text-gray-400">${s.reason || 'Sin motivo'} • ${formatDate(s.date)}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-yellow-400 font-bold">-${s.quantity}</p>
          <p class="text-red-400 text-sm">${formatCLP(s.total)}</p>
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function renderMoney() {
  const container = document.getElementById('moneyList');
  const fromDate = document.getElementById('moneyDateFrom').value;
  const toDate = document.getElementById('moneyDateTo').value;
  const typeFilter = document.getElementById('filterMoneyType').value;
  
  let filtered = filterByDate(moneyRecords, 'date', fromDate, toDate);
  if (typeFilter) {
    filtered = filtered.filter(m => m.moneyType === typeFilter);
  }
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const income = filtered.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0);
  const expense = filtered.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0);
  
  document.getElementById('moneyIncomeTotal').textContent = formatCLP(income);
  document.getElementById('moneyExpenseTotal').textContent = formatCLP(expense);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-8">No hay registros de dinero</p>';
    return;
  }
  
  container.innerHTML = filtered.map(m => {
    const isIncome = m.moneyType === 'ingreso';
    const deleteBtn = isTestUser 
      ? '' 
      : `<button onclick="deleteMoney('${m.id}')" class="text-xs text-gray-400 hover:text-red-400">Eliminar</button>`;
    
    return `
      <div class="glass rounded-xl p-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg ${isIncome ? 'bg-green-500/30' : 'bg-red-500/30'} flex items-center justify-center">
            <svg class="w-5 h-5 ${isIncome ? 'text-green-400' : 'text-red-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"/>
            </svg>
          </div>
          <div>
            <p class="font-medium">${m.description}</p>
            <p class="text-sm text-gray-400">${m.reference || 'Sin ref.'} • ${formatDate(m.date)}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="${isIncome ? 'text-green-400' : 'text-red-400'} font-bold">${isIncome ? '+' : '-'}${formatCLP(m.amount)}</p>
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function updateProductSelects() {
  setupProductSearchDropdown('movProductSearch', 'movProductList', 'movProductDropdown', 'movProduct');
  setupProductSearchDropdown('shrinkProductSearch', 'shrinkProductList', 'shrinkProductDropdown', 'shrinkProduct');
}

function setupProductSearchDropdown(searchId, listId, dropdownId, hiddenId) {
  const searchInput = document.getElementById(searchId);
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const search = e.target.value.toLowerCase();
    const list = document.getElementById(listId);
    const dropdown = document.getElementById(dropdownId);

    if (!search) {
      dropdown.classList.add('hidden');
      return;
    }

    const filtered = products.filter(p =>
      p.name.toLowerCase().includes(search) ||
      (p.sku && p.sku.toLowerCase().includes(search))
    );

    list.innerHTML = filtered.map(p => `
      <div class="p-2 cursor-pointer hover:bg-white/20 rounded transition-all" onclick="selectProductItem('${p.id}', '${p.name}', '${searchId}', '${hiddenId}', '${dropdownId}')">
        <div class="font-medium text-sm">${p.name}</div>
        <div class="text-xs text-gray-400">${p.category || ''} ${p.sku ? '• ' + p.sku : ''}</div>
      </div>
    `).join('');

    dropdown.classList.remove('hidden');
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value) {
      document.getElementById(dropdownId).classList.remove('hidden');
    }
  });
}

window.selectProductItem = function(id, name, searchId, hiddenId, dropdownId) {
  document.getElementById(searchId).value = name;
  document.getElementById(hiddenId).value = id;
  document.getElementById(dropdownId).classList.add('hidden');
};

function updateCategoryFilter() {
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
  const select = document.getElementById('filterCategory');
  const datalist = document.getElementById('categories');
  
  select.innerHTML = '<option value="">Todas las categorías</option>' + 
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
  
  datalist.innerHTML = categories.map(c => `<option value="${c}">`).join('');
}

// Event Listeners - Menu
document.getElementById('menuBtn').addEventListener('click', () => {
  document.getElementById('sideMenu').classList.remove('-translate-x-full');
  document.getElementById('menuOverlay').classList.remove('hidden');
});

document.getElementById('closeMenu').addEventListener('click', closeMenu);
document.getElementById('menuOverlay').addEventListener('click', closeMenu);

function closeMenu() {
  document.getElementById('sideMenu').classList.add('-translate-x-full');
  document.getElementById('menuOverlay').classList.add('hidden');
}

document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const section = item.dataset.section;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(section).classList.add('active');
    closeMenu();
  });
});

// Products Events
document.getElementById('addProductBtn').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes agregar productos en modo visualización', 'error');
    return;
  }
  
  document.getElementById('productId').value = '';
  document.getElementById('productForm').reset();
  document.getElementById('productModalTitle').textContent = 'Nuevo Producto';
  document.getElementById('productModal').classList.remove('hidden');
});

document.getElementById('closeProductModal').addEventListener('click', () => {
  document.getElementById('productModal').classList.add('hidden');
});

document.getElementById('cancelProduct').addEventListener('click', () => {
  document.getElementById('productModal').classList.add('hidden');
});

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isLoading || isTestUser) return;
  
  const id = document.getElementById('productId').value;
  const data = {
    name: document.getElementById('productName').value,
    sku: document.getElementById('productSku').value,
    category: document.getElementById('productCategory').value,
    price: parseFloat(document.getElementById('productPrice').value) || 0,
    cost: parseFloat(document.getElementById('productCost').value) || 0,
    stock: parseInt(document.getElementById('productStock').value) || 0,
    minStock: parseInt(document.getElementById('productMinStock').value) || 5,
    unit: document.getElementById('productUnit').value,
    createdAt: new Date().toISOString()
  };
  
  isLoading = true;
  let result;
  
  if (id) {
    result = await updateItem('products', id, data);
  } else {
    result = await createItem('products', data);
  }
  
  isLoading = false;
  
  if (result.isOk) {
    showToast(id ? 'Producto actualizado' : 'Producto creado');
    document.getElementById('productModal').classList.add('hidden');
  } else {
    showToast('Error al guardar producto', 'error');
  }
});

window.editProduct = function(id) {
  if (isTestUser) {
    showToast('No puedes editar productos en modo visualización', 'error');
    return;
  }
  
  const product = products.find(p => p.id === id);
  if (!product) return;
  
  document.getElementById('productId').value = id;
  document.getElementById('productName').value = product.name;
  document.getElementById('productSku').value = product.sku || '';
  document.getElementById('productCategory').value = product.category || '';
  document.getElementById('productPrice').value = product.price || 0;
  document.getElementById('productCost').value = product.cost || 0;
  document.getElementById('productStock').value = product.stock || 0;
  document.getElementById('productMinStock').value = product.minStock || 5;
  document.getElementById('productUnit').value = product.unit || 'unidad';
  
  document.getElementById('productModalTitle').textContent = 'Editar Producto';
  document.getElementById('productModal').classList.remove('hidden');
};

window.deleteProduct = async function(id) {
  if (isTestUser) {
    showToast('No puedes eliminar productos en modo visualización', 'error');
    return;
  }
  
  const confirmed = await showConfirm('Eliminar Producto', '¿Estás seguro de eliminar este producto?');
  if (!confirmed) return;
  
  const result = await deleteItem('products', id);
  if (result.isOk) {
    showToast('Producto eliminado');
  } else {
    showToast('Error al eliminar', 'error');
  }
};

document.getElementById('searchProduct').addEventListener('input', renderProducts);
document.getElementById('filterCategory').addEventListener('change', renderProducts);

// Movements Events
document.getElementById('addMovementBtn').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes agregar movimientos en modo visualización', 'error');
    return;
  }
  
  document.getElementById('movementForm').reset();
  document.getElementById('movDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('movementModal').classList.remove('hidden');
});

document.getElementById('closeMovementModal').addEventListener('click', () => {
  document.getElementById('movementModal').classList.add('hidden');
});

document.getElementById('cancelMovement').addEventListener('click', () => {
  document.getElementById('movementModal').classList.add('hidden');
});

document.getElementById('movementForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isLoading || isTestUser) return;
  
  const productId = document.getElementById('movProduct').value;
  const product = products.find(p => p.id === productId);
  if (!product) {
    showToast('Selecciona un producto', 'error');
    return;
  }
  
  const quantity = parseInt(document.getElementById('movQuantity').value) || 0;
  const movementType = document.getElementById('movType').value;
  const reason = document.getElementById('movReason').value;
  const movDate = document.getElementById('movDate').value || new Date().toISOString().split('T')[0];
  
  if (movementType === 'salida' && quantity > (product.stock || 0)) {
    showToast('Stock insuficiente', 'error');
    return;
  }
  
  isLoading = true;
  
  const newStock = movementType === 'entrada' 
    ? (product.stock || 0) + quantity 
    : (product.stock || 0) - quantity;
  
  await updateItem('products', productId, { ...product, stock: newStock });
  
  const movementResult = await createItem('movements', {
    productId,
    quantity,
    movementType,
    reason: reason,
    date: movDate,
    createdAt: new Date().toISOString()
  });
  
  if (movementType === 'salida') {
    const saleAmount = (product.price || 0) * quantity;
    
    await createItem('money', {
      moneyType: 'ingreso',
      amount: saleAmount,
      description: reason || `Venta: ${product.name} (${quantity} ${product.unit || 'unidad'})`,
      reference: `Venta-${Date.now()}`,
      date: movDate,
      createdAt: new Date().toISOString()
    });
    
    showToast(`Venta registrada: ${formatCLP(saleAmount)} ingresados`);
  } else {
    showToast('Movimiento registrado');
  }
  
  isLoading = false;
  document.getElementById('movementModal').classList.add('hidden');
});

window.deleteMovement = async function(id) {
  if (isTestUser) {
    showToast('No puedes eliminar movimientos en modo visualización', 'error');
    return;
  }
  
  const confirmed = await showConfirm('Eliminar Movimiento', '¿Estás seguro?');
  if (!confirmed) return;
  
  const result = await deleteItem('movements', id);
  if (result.isOk) {
    showToast('Movimiento eliminado');
  } else {
    showToast('Error al eliminar', 'error');
  }
};

document.getElementById('movDateFrom').addEventListener('change', renderMovements);
document.getElementById('movDateTo').addEventListener('change', renderMovements);
document.getElementById('filterMovType').addEventListener('change', renderMovements);

// Shrinkage Events
document.getElementById('addShrinkageBtn').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes registrar mermas en modo visualización', 'error');
    return;
  }
  
  document.getElementById('shrinkageForm').reset();
  document.getElementById('shrinkDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('shrinkageModal').classList.remove('hidden');
});

document.getElementById('closeShrinkageModal').addEventListener('click', () => {
  document.getElementById('shrinkageModal').classList.add('hidden');
});

document.getElementById('cancelShrinkage').addEventListener('click', () => {
  document.getElementById('shrinkageModal').classList.add('hidden');
});

document.getElementById('shrinkageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isLoading || isTestUser) return;
  
  const productId = document.getElementById('shrinkProduct').value;
  const product = products.find(p => p.id === productId);
  if (!product) {
    showToast('Selecciona un producto', 'error');
    return;
  }
  
  const quantity = parseInt(document.getElementById('shrinkQuantity').value) || 0;
  
  if (quantity > (product.stock || 0)) {
    showToast('Cantidad mayor al stock', 'error');
    return;
  }
  
  isLoading = true;
  
  const newStock = (product.stock || 0) - quantity;
  await updateItem('products', productId, { ...product, stock: newStock });
  
  const total = (product.cost || product.price || 0) * quantity;
  
  const result = await createItem('shrinkages', {
    productId,
    quantity,
    reason: document.getElementById('shrinkReason').value,
    date: document.getElementById('shrinkDate').value || new Date().toISOString().split('T')[0],
    total,
    createdAt: new Date().toISOString()
  });
  
  isLoading = false;
  
  if (result.isOk) {
    showToast('Merma registrada');
    document.getElementById('shrinkageModal').classList.add('hidden');
  } else {
    showToast('Error al registrar', 'error');
  }
});

window.deleteShrinkage = async function(id) {
  if (isTestUser) {
    showToast('No puedes eliminar mermas en modo visualización', 'error');
    return;
  }
  
  const confirmed = await showConfirm('Eliminar Merma', '¿Estás seguro?');
  if (!confirmed) return;
  
  const result = await deleteItem('shrinkages', id);
  if (result.isOk) {
    showToast('Merma eliminada');
  } else {
    showToast('Error al eliminar', 'error');
  }
};

document.getElementById('shrinkDateFrom').addEventListener('change', renderShrinkages);
document.getElementById('shrinkDateTo').addEventListener('change', renderShrinkages);

// Money Events
document.getElementById('addMoneyBtn').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes agregar registros de dinero en modo visualización', 'error');
    return;
  }
  
  document.getElementById('moneyForm').reset();
  document.getElementById('moneyDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('moneyModal').classList.remove('hidden');
});

document.getElementById('closeMoneyModal').addEventListener('click', () => {
  document.getElementById('moneyModal').classList.add('hidden');
});

document.getElementById('cancelMoney').addEventListener('click', () => {
  document.getElementById('moneyModal').classList.add('hidden');
});

document.getElementById('moneyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isLoading || isTestUser) return;
  
  isLoading = true;
  
  const result = await createItem('money', {
    moneyType: document.getElementById('moneyType').value,
    amount: parseFloat(document.getElementById('moneyAmount').value) || 0,
    description: document.getElementById('moneyDescription').value,
    reference: document.getElementById('moneyRef').value,
    date: document.getElementById('moneyDate').value || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  });
  
  isLoading = false;
  
  if (result.isOk) {
    showToast('Registro guardado');
    document.getElementById('moneyModal').classList.add('hidden');
  } else {
    showToast('Error al guardar', 'error');
  }
});

window.deleteMoney = async function(id) {
  if (isTestUser) {
    showToast('No puedes eliminar registros en modo visualización', 'error');
    return;
  }
  
  const confirmed = await showConfirm('Eliminar Registro', '¿Estás seguro?');
  if (!confirmed) return;
  
  const result = await deleteItem('money', id);
  if (result.isOk) {
    showToast('Registro eliminado');
  } else {
    showToast('Error al eliminar', 'error');
  }
};

document.getElementById('moneyDateFrom').addEventListener('change', renderMoney);
document.getElementById('moneyDateTo').addEventListener('change', renderMoney);
document.getElementById('filterMoneyType').addEventListener('change', renderMoney);

// Services Events
document.getElementById('addServiceBtn').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes agregar servicios en modo visualización', 'error');
    return;
  }
  
  document.getElementById('serviceForm').reset();
  document.getElementById('serviceDueDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('serviceModal').classList.remove('hidden');
});

document.getElementById('closeServiceModal').addEventListener('click', () => {
  document.getElementById('serviceModal').classList.add('hidden');
});

document.getElementById('cancelService').addEventListener('click', () => {
  document.getElementById('serviceModal').classList.add('hidden');
});

document.getElementById('serviceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isTestUser) return;
  
  const service = {
    name: document.getElementById('serviceName').value,
    amount: parseFloat(document.getElementById('serviceAmount').value) || 0,
    dueDate: document.getElementById('serviceDueDate').value || null,
    createdAt: new Date().toISOString()
  };
  
  services.push(service);
  saveServices();
  renderServices();
  
  document.getElementById('serviceModal').classList.add('hidden');
  showToast('Servicio agregado');
});

// Dashboard Events
document.getElementById('dashDateFrom').addEventListener('change', renderDashboard);
document.getElementById('dashDateTo').addEventListener('change', renderDashboard);

// Reports Events
document.getElementById('reportPeriod').addEventListener('change', (e) => {
  document.getElementById('customDateRange').classList.toggle('hidden', e.target.value !== 'custom');
});

document.getElementById('generateReport').addEventListener('click', () => {
  const type = document.getElementById('reportType').value;
  const period = document.getElementById('reportPeriod').value;
  let fromDate, toDate;
  
  if (period === 'custom') {
    fromDate = document.getElementById('reportDateFrom').value;
    toDate = document.getElementById('reportDateTo').value;
  } else {
    const range = getDateRange(period);
    fromDate = range.from ? range.from.toISOString().split('T')[0] : null;
    toDate = range.to ? range.to.toISOString().split('T')[0] : null;
  }
  
  const container = document.getElementById('reportContent');
  let html = '';
  
  const periodText = period === 'daily' ? 'Diario' : period === 'weekly' ? 'Semanal' : period === 'monthly' ? 'Mensual' : 'Personalizado';
  
  if (type === 'general' || type === 'products') {
    html += `
      <div class="mb-4">
        <h4 class="font-semibold mb-2">📦 Inventario de Productos</h4>
        <div class="glass rounded-lg p-3">
          <p>Total productos: <strong>${products.length}</strong></p>
          <p>Valor total: <strong>${formatCLP(products.reduce((sum, p) => sum + ((p.cost || p.price) * p.stock), 0))}</strong></p>
          <p>Stock bajo: <strong class="text-orange-400">${products.filter(p => p.stock <= p.minStock).length}</strong></p>
        </div>
      </div>
    `;
  }
  
  if (type === 'general' || type === 'movements') {
    const filteredMov = filterByDate(movements, 'date', fromDate, toDate);
    const entries = filteredMov.filter(m => m.movementType === 'entrada');
    const exits = filteredMov.filter(m => m.movementType === 'salida');
    html += `
      <div class="mb-4">
        <h4 class="font-semibold mb-2">📊 Movimientos (${periodText})</h4>
        <div class="glass rounded-lg p-3">
          <p>Total movimientos: <strong>${filteredMov.length}</strong></p>
          <p class="text-green-400">Entradas: <strong>${entries.reduce((sum, m) => sum + m.quantity, 0)}</strong> (${entries.length} mov.)</p>
          <p class="text-red-400">Salidas: <strong>${exits.reduce((sum, m) => sum + m.quantity, 0)}</strong> (${exits.length} mov.)</p>
        </div>
      </div>
    `;
  }
  
  if (type === 'general' || type === 'shrinkage') {
    const filteredShrink = filterByDate(shrinkages, 'date', fromDate, toDate);
    html += `
      <div class="mb-4">
        <h4 class="font-semibold mb-2">⚠️ Mermas (${periodText})</h4>
        <div class="glass rounded-lg p-3">
          <p>Total mermas: <strong>${filteredShrink.length}</strong></p>
          <p class="text-red-400">Pérdida total: <strong>${formatCLP(filteredShrink.reduce((sum, s) => sum + s.total, 0))}</strong></p>
        </div>
      </div>
    `;
  }
  
  if (type === 'general' || type === 'money') {
    const filteredMoney = filterByDate(moneyRecords, 'date', fromDate, toDate);
    const income = filteredMoney.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + m.amount, 0);
    const expense = filteredMoney.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + m.amount, 0);
    html += `
      <div class="mb-4">
        <h4 class="font-semibold mb-2">💰 Flujo de Dinero (${periodText})</h4>
        <div class="glass rounded-lg p-3">
          <p class="text-green-400">Ingresos: <strong>${formatCLP(income)}</strong></p>
          <p class="text-red-400">Salidas: <strong>${formatCLP(expense)}</strong></p>
          <p class="${income - expense >= 0 ? 'text-green-400' : 'text-red-400'}">Balance: <strong>${formatCLP(income - expense)}</strong></p>
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
  document.getElementById('reportResult').classList.remove('hidden');
});

document.getElementById('exportReport').addEventListener('click', () => {
  exportToExcel('reporte');
});

function exportToExcel(filename) {
  try {
    const wb = XLSX.utils.book_new();
    const today = new Date().toISOString().split('T')[0];
    
    if (products.length > 0) {
      const productData = [
        ['INVENTARIO DE PRODUCTOS'],
        [''],
        ['Nombre', ...products.map(p => p.name || '')],
        ['SKU', ...products.map(p => p.sku || '')],
        ['Categoría', ...products.map(p => p.category || '')],
        ['Precio Venta', ...products.map(p => p.price || 0)],
        ['Costo', ...products.map(p => p.cost || 0)],
        ['Stock', ...products.map(p => p.stock || 0)],
        ['Stock Mínimo', ...products.map(p => p.minStock || 5)],
        ['Unidad', ...products.map(p => p.unit || 'unidad')],
        ['Valor Total', ...products.map(p => ((p.cost || p.price || 0) * (p.stock || 0)))],
        [''],
        ['Fecha de exportación:', today]
      ];
      
      const wsProducts = XLSX.utils.aoa_to_sheet(productData);
      XLSX.utils.book_append_sheet(wb, wsProducts, 'Productos');
    }
    
    if (movements.length > 0) {
      const movementData = [
        ['REGISTRO DE MOVIMIENTOS'],
        [''],
        ['Fecha', ...movements.map(m => m.date || '')],
        ['Producto', ...movements.map(m => {
          const product = products.find(p => p.id === m.productId);
          return product?.name || 'Producto eliminado';
        })],
        ['Tipo', ...movements.map(m => m.movementType === 'entrada' ? 'ENTRADA' : 'SALIDA')],
        ['Cantidad', ...movements.map(m => m.quantity || 0)],
        ['Motivo', ...movements.map(m => m.reason || '')],
        [''],
        ['Total Entradas:', movements.filter(m => m.movementType === 'entrada').reduce((sum, m) => sum + (m.quantity || 0), 0)],
        ['Total Salidas:', movements.filter(m => m.movementType === 'salida').reduce((sum, m) => sum + (m.quantity || 0), 0)],
        [''],
        ['Fecha de exportación:', today]
      ];
      
      const wsMovements = XLSX.utils.aoa_to_sheet(movementData);
      XLSX.utils.book_append_sheet(wb, wsMovements, 'Movimientos');
    }
    
    if (shrinkages.length > 0) {
      const shrinkageData = [
        ['REGISTRO DE MERMAS'],
        [''],
        ['Fecha', ...shrinkages.map(s => s.date || '')],
        ['Producto', ...shrinkages.map(s => {
          const product = products.find(p => p.id === s.productId);
          return product?.name || 'Producto eliminado';
        })],
        ['Cantidad', ...shrinkages.map(s => s.quantity || 0)],
        ['Motivo', ...shrinkages.map(s => s.reason || '')],
        ['Valor Unitario', ...shrinkages.map(s => {
          const product = products.find(p => p.id === s.productId);
          return product?.cost || product?.price || 0;
        })],
        ['Total Pérdida', ...shrinkages.map(s => s.total || 0)],
        [''],
        ['Total mermas:', shrinkages.length],
        ['Pérdida total:', shrinkages.reduce((sum, s) => sum + (s.total || 0), 0)],
        [''],
        ['Fecha de exportación:', today]
      ];
      
      const wsShrinkages = XLSX.utils.aoa_to_sheet(shrinkageData);
      XLSX.utils.book_append_sheet(wb, wsShrinkages, 'Mermas');
    }
    
    if (moneyRecords.length > 0) {
      const moneyData = [
        ['REGISTRO DE DINERO'],
        [''],
        ['Fecha', ...moneyRecords.map(m => m.date || '')],
        ['Tipo', ...moneyRecords.map(m => m.moneyType === 'ingreso' ? 'INGRESO' : 'SALIDA')],
        ['Descripción', ...moneyRecords.map(m => m.description || '')],
        ['Monto', ...moneyRecords.map(m => m.amount || 0)],
        ['Referencia', ...moneyRecords.map(m => m.reference || '')],
        [''],
        ['Total Ingresos:', moneyRecords.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0)],
        ['Total Salidas:', moneyRecords.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0)],
        ['Balance:', moneyRecords.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0) - 
                   moneyRecords.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0)],
        [''],
        ['Fecha de exportación:', today]
      ];
      
      const wsMoney = XLSX.utils.aoa_to_sheet(moneyData);
      XLSX.utils.book_append_sheet(wb, wsMoney, 'Dinero');
    }
    
    if (services.length > 0) {
      const serviceData = [
        ['SERVICIOS A PAGAR'],
        [''],
        ['Nombre', ...services.map(s => s.name || '')],
        ['Monto', ...services.map(s => s.amount || 0)],
        ['Fecha Vencimiento', ...services.map(s => s.dueDate || '')],
        ['Fecha Creación', ...services.map(s => s.createdAt || '')],
        ['Estado', ...services.map(s => {
          if (!s.dueDate) return 'PENDIENTE';
          const dueDate = new Date(s.dueDate);
          const today = new Date();
          return dueDate < today ? 'VENCIDO' : 'PENDIENTE';
        })],
        [''],
        ['Total servicios:', services.length],
        ['Monto total:', services.reduce((sum, s) => sum + (s.amount || 0), 0)],
        ['Servicios vencidos:', services.filter(s => {
          if (!s.dueDate) return false;
          return new Date(s.dueDate) < new Date();
        }).length],
        [''],
        ['Fecha de exportación:', today]
      ];
      
      const wsServices = XLSX.utils.aoa_to_sheet(serviceData);
      XLSX.utils.book_append_sheet(wb, wsServices, 'Servicios');
    }
    
    const summaryData = [
      ['RESUMEN GENERAL DEL INVENTARIO'],
      [''],
      ['Fecha de exportación:', today],
      [''],
      ['INVENTARIO'],
      ['Total productos:', products.length],
      ['Valor total inventario:', products.reduce((sum, p) => sum + ((p.cost || p.price || 0) * (p.stock || 0)), 0)],
      ['Productos con stock bajo:', products.filter(p => (p.stock || 0) <= (p.minStock || 5)).length],
      [''],
      ['MOVIMIENTOS'],
      ['Total movimientos:', movements.length],
      ['Entradas:', movements.filter(m => m.movementType === 'entrada').length],
      ['Salidas:', movements.filter(m => m.movementType === 'salida').length],
      [''],
      ['MERMAS'],
      ['Total mermas:', shrinkages.length],
      ['Pérdida total:', shrinkages.reduce((sum, s) => sum + (s.total || 0), 0)],
      [''],
      ['DINERO'],
      ['Total ingresos:', moneyRecords.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0)],
      ['Total salidas:', moneyRecords.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0)],
      ['Balance neto:', moneyRecords.filter(m => m.moneyType === 'ingreso').reduce((sum, m) => sum + (m.amount || 0), 0) - 
                     moneyRecords.filter(m => m.moneyType === 'salida').reduce((sum, m) => sum + (m.amount || 0), 0)],
      [''],
      ['SERVICIOS'],
      ['Total servicios:', services.length],
      ['Monto total servicios:', services.reduce((sum, s) => sum + (s.amount || 0), 0)]
    ];
    
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');
    
    XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
    showToast('✅ Archivo Excel generado exitosamente');
  } catch (error) {
    console.error('Error al exportar a Excel:', error);
    showToast('❌ Error al generar el archivo Excel', 'error');
  }
}

document.getElementById('createBackup').addEventListener('click', () => {
  if (isTestUser) {
    showToast('No puedes crear respaldos en modo visualización', 'error');
    return;
  }
  exportToExcel('respaldo_inventario');
});

document.getElementById('backupFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('backupFileName').textContent = file.name;
    document.getElementById('backupFileName').classList.remove('hidden');
    document.getElementById('restoreBackup').classList.remove('hidden');
  }
});

document.getElementById('restoreBackup').addEventListener('click', async () => {
  if (isTestUser) {
    showToast('No puedes restaurar respaldos en modo visualización', 'error');
    return;
  }
  
  const file = document.getElementById('backupFile').files[0];
  if (!file) return;
  
  const confirmed = await showConfirm('Restaurar Respaldo', 'Esto agregará los datos del archivo. ¿Continuar?');
  if (!confirmed) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = e.target.result;
      const lines = text.split('\n');
      let section = '';
      let count = 0;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        if (trimmed === 'PRODUCTOS') { section = 'products'; continue; }
        if (trimmed === 'MOVIMIENTOS') { section = 'movements'; continue; }
        if (trimmed === 'MERMAS') { section = 'shrinkages'; continue; }
        if (trimmed === 'DINERO') { section = 'money'; continue; }
        if (trimmed === 'SERVICIOS') { section = 'services'; continue; }
        if (trimmed.startsWith('Nombre,') || trimmed.startsWith('Producto,') || trimmed.startsWith('Tipo,')) continue;
        
        const parts = trimmed.match(/(".*?"|[^,]+)/g)?.map(s => s.replace(/^"|"$/g, ''));
        if (!parts || parts.length < 2) continue;
        
        if (section === 'products' && parts.length >= 8) {
          await createItem('products', {
            name: parts[0],
            sku: parts[1],
            category: parts[2],
            price: parseFloat(parts[3]) || 0,
            cost: parseFloat(parts[4]) || 0,
            stock: parseInt(parts[5]) || 0,
            minStock: parseInt(parts[6]) || 5,
            unit: parts[7],
            createdAt: new Date().toISOString()
          });
          count++;
        } else if (section === 'services' && parts.length >= 4) {
          services.push({
            name: parts[0],
            amount: parseFloat(parts[1]) || 0,
            dueDate: parts[2] || null,
            createdAt: parts[3] || new Date().toISOString()
          });
          saveServices();
          count++;
        }
      }
      
      showToast(`Restaurados ${count} registros`);
      document.getElementById('backupFile').value = '';
      document.getElementById('backupFileName').classList.add('hidden');
      document.getElementById('restoreBackup').classList.add('hidden');
    } catch (err) {
      showToast('Error al leer archivo', 'error');
    }
  };
  reader.readAsText(file);
});

document.getElementById('clearAllData').addEventListener('click', async () => {
  if (isTestUser) {
    showToast('No puedes eliminar datos en modo visualización', 'error');
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  const randomWord = verificationWords[Math.floor(Math.random() * verificationWords.length)];
  
  const inputDate = document.getElementById('confirmTodayDate').value;
  const inputWord = document.getElementById('confirmWord').value.toUpperCase();
  
  if (inputDate !== today || inputWord !== randomWord) {
    showToast('Verificación incorrecta. Revisa la fecha y la palabra.', 'error');
    return;
  }
  
  const confirmed = await showConfirm(
    '⚠️ ELIMINAR TODOS LOS DATOS', 
    'ESTA ACCIÓN ELIMINARÁ PERMANENTEMENTE:\n\n• Todos los productos\n• Todos los movimientos\n• Todas las mermas\n• Todos los registros de dinero\n• Todos los servicios\n\n¿ESTÁS ABSOLUTAMENTE SEGURO?'
  );
  
  if (!confirmed) return;
  
  isLoading = true;
  
  if (initFirebase()) {
    const { ref, remove, database } = window.firebaseDB;
    try {
      const inventarioRef = ref(database, 'inventario');
      await remove(inventarioRef);
      showToast('✅ Todos los datos han sido eliminados');
    } catch (error) {
      showToast('❌ Error al eliminar datos', 'error');
    }
  }
  
  services = [];
  saveServices();
  renderServices();
  
  isLoading = false;
  
  document.getElementById('confirmTodayDate').value = '';
  document.getElementById('confirmWord').value = '';
  
  const newRandomWord = verificationWords[Math.floor(Math.random() * verificationWords.length)];
  document.getElementById('confirmWordLabel').innerHTML = `Palabra de verificación: <strong class="text-yellow-400">${newRandomWord}</strong>`;
});

function onConfigChange(newConfig) {
  config = { ...defaultConfig, ...newConfig };
  document.getElementById('businessTitle').textContent = config.business_name || defaultConfig.business_name;
  renderAll();
}

async function init() {
  // Detectar usuario de prueba desde localStorage
  const testUserFlag = localStorage.getItem('isTestUser');
  if (testUserFlag === 'true') {
    isTestUser = true;
  }
  
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
  
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  document.getElementById('dashDateFrom').value = weekAgo;
  document.getElementById('dashDateTo').value = today;
  document.getElementById('movDateFrom').value = weekAgo;
  document.getElementById('movDateTo').value = today;
  document.getElementById('shrinkDateFrom').value = weekAgo;
  document.getElementById('shrinkDateTo').value = today;
  document.getElementById('moneyDateFrom').value = weekAgo;
  document.getElementById('moneyDateTo').value = today;
  
  services = JSON.parse(localStorage.getItem('inventario_services')) || [];
  
  const randomWord = verificationWords[Math.floor(Math.random() * verificationWords.length)];
  document.getElementById('confirmWordLabel').innerHTML = `Palabra de verificación: <strong class="text-yellow-400">${randomWord}</strong>`;
  
  if (window.elementSdk) {
    await window.elementSdk.init({
      defaultConfig,
      onConfigChange,
      mapToCapabilities: (cfg) => ({
        recolorables: [],
        borderables: [],
        fontEditable: undefined,
        fontSizeable: undefined
      }),
      mapToEditPanelValues: (cfg) => new Map([
        ['business_name', cfg.business_name || defaultConfig.business_name],
        ['currency_symbol', cfg.currency_symbol || defaultConfig.currency_symbol]
      ])
    });
  }
  
  await loadFirebaseData();
  renderServices();
  disableEditingForTestUser();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
