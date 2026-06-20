const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// ============ FIREBASE CLIENT ============
let firebaseAuth = null;
let firebaseDb = null;

// Wait for Firebase to load
setTimeout(() => {
  if (window.firebaseAuth) {
    firebaseAuth = window.firebaseAuth;
    firebaseDb = window.firebaseDb;
    console.log("Firebase client ready");
  }
}, 100);

function toggleMenu() {
  const links = $('.nav-links');
  if (links) links.classList.toggle('active');
}

function setActiveNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  $$('.nav-links a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) link.classList.add('active');
  });
}

function formatValue(value) {
  if (!value) return 'Not specified';
  return String(value).replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function authToken() {
  return localStorage.getItem('authToken') || '';
}

function currentUser() {
  return safeJSON('currentUser', null);
}

function authHeaders(extra = {}) {
  const token = authToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function isLoggedIn() {
  return Boolean(authToken() && currentUser());
}

function applyTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = $('#themeToggle');
  if (toggle) toggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i> Light Mode' : '<i class="fas fa-moon"></i> Dark Mode';
}

function toggleTheme() {
  const next = (localStorage.getItem('theme') || 'light') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme();
  showToast(`${formatValue(next)} mode activated.`);
}

function updateAuthNav() {
  const nav = $('.nav-links');
  if (!nav) return;
  const user = currentUser();
  const loginLink = [...nav.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'login.html');
  const signupLink = [...nav.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'signup.html');
  if (user) {
    if (loginLink) {
      loginLink.href = 'profile.html';
      loginLink.textContent = user.name ? user.name.split(' ')[0] : 'Profile';
    }
    if (signupLink) {
      signupLink.href = '#logout';
      signupLink.textContent = 'Logout';
      signupLink.onclick = (event) => { event.preventDefault(); logoutUser(); };
    }
  }
}

async function logoutUser() {
  if (firebaseAuth) {
    try { await firebaseAuth.signOut(); } catch(e) {}
  }
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  showToast('Logged out successfully.');
  setTimeout(() => location.href = 'index.html', 500);
}

function showToast(message, type = 'success') {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function setupContactForm() {
  const form = $('#contactForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = $('#contactNote');
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      note.textContent = data.message || data.error || 'Message sent.';
      note.className = response.ok ? 'form-note' : 'form-error';
      note.classList.remove('hidden');
      if (response.ok) form.reset();
    } catch {
      note.textContent = 'Could not send the message. Please try again later.';
      note.className = 'form-error';
      note.classList.remove('hidden');
    }
  });
}

function setFieldError(field, message) {
  if (!field) return;
  field.classList.add('invalid-field');
  const wrap = field.closest('.form-group') || field.parentElement;
  let error = wrap.querySelector('.field-error');
  if (!error) {
    error = document.createElement('small');
    error.className = 'field-error';
    wrap.appendChild(error);
  }
  error.textContent = message;
}

function clearFieldErrors(form) {
  form.querySelectorAll('.invalid-field').forEach((el) => el.classList.remove('invalid-field'));
  form.querySelectorAll('.field-error').forEach((el) => el.remove());
}

function updateFormProgress(form) {
  const requiredInputs = ['style', 'color', 'shape', 'image'].map((name) => form.elements[name]).filter(Boolean);
  const filled = requiredInputs.filter((input) => String(input.value || '').trim()).length;
  const percent = Math.round((filled / requiredInputs.length) * 100);
  const bar = $('#formProgressBar');
  const label = $('#formProgressText');
  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = `${filled}/${requiredInputs.length} required fields completed`;
}

function setupGenerateForm() {
  const form = $('#designForm');
  if (!form) return;

  const budget = $('#budget');
  const budgetValue = $('#budgetValue');
  const uploadBox = $('#uploadBox');
  const fileInput = $('#roomImage');
  const preview = $('#uploadPreview');
  const errorBox = $('#formError');
  const submitBtn = $('.generate-btn');
  const removeUpload = $('#removeUpload');
  const loadingOverlay = $('#generationOverlay');
  const loadingStep = $('#generationStep');
  const loadingSteps = [
    'Reading your room preferences...',
    'Building a detailed interior design prompt...',
    'Generating the AI design image...',
    'Preparing your updated result page...',
  ];

  form.addEventListener('input', () => updateFormProgress(form));
  updateFormProgress(form);

  if (budget && budgetValue) {
    budget.addEventListener('input', () => {
      budgetValue.textContent = Number(budget.value).toLocaleString();
    });
  }

  if (uploadBox && fileInput) {
    uploadBox.addEventListener('click', (event) => {
      if (event.target.closest('#removeUpload')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        errorBox.textContent = 'Please upload an image file only.';
        errorBox.classList.remove('hidden');
        fileInput.value = '';
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        errorBox.textContent = 'Image size must be less than 5MB.';
        errorBox.classList.remove('hidden');
        fileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        preview.innerHTML = `<img src="${event.target.result}" alt="Uploaded room preview"><small>${file.name}</small>`;
        preview.style.display = 'block';
        uploadBox.classList.add('has-file');
        if (removeUpload) removeUpload.classList.remove('hidden');
        sessionStorage.setItem('beforeImage', event.target.result);
        updateFormProgress(form);
        showToast('Room photo added successfully.');
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeUpload && fileInput && preview && uploadBox) {
    removeUpload.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      fileInput.value = '';
      preview.innerHTML = '';
      preview.style.display = 'none';
      uploadBox.classList.remove('has-file');
      removeUpload.classList.add('hidden');
      sessionStorage.removeItem('beforeImage');
      updateFormProgress(form);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    errorBox.classList.add('hidden');

    const formData = new FormData(form);
    const required = [
      { key: 'style', label: 'style' },
      { key: 'color', label: 'colour scheme' },
      { key: 'shape', label: 'furniture shape' },
      { key: 'image', label: 'room photo' },
    ];
    const missing = required.filter((item) => !String(formData.get(item.key) || '').trim());

    if (missing.length) {
      missing.forEach((item) => setFieldError(form.elements[item.key], `Please enter ${item.label}.`));
      errorBox.textContent = `Please complete: ${missing.map((item) => item.label).join(', ')}.`;
      errorBox.classList.remove('hidden');
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    let stepIndex = 0;
    const stepTimer = setInterval(() => {
      if (loadingStep) loadingStep.textContent = loadingSteps[stepIndex % loadingSteps.length];
      stepIndex += 1;
    }, 1400);

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Generating design...';
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (loadingStep) loadingStep.textContent = loadingSteps[0];

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      const data = await response.json();

      if (!response.ok || !data.imageUrl) {
        throw new Error(data.details || data.error || 'AI generation failed. Please try again.');
      }

      const designData = Object.fromEntries(formData.entries());
      delete designData.image;
      const createdAt = new Date().toISOString();
      sessionStorage.setItem('designData', JSON.stringify(designData));
      sessionStorage.setItem('generatedImage', data.imageUrl);
      sessionStorage.setItem('generatedPrompt', data.prompt || '');
      sessionStorage.setItem('generatedProvider', data.provider || 'AI provider');
      if (data.beforeImage) sessionStorage.setItem('beforeImage', data.beforeImage);
      sessionStorage.setItem('isDemoResult', data.demo ? 'true' : 'false');
      sessionStorage.setItem('demoMessage', data.message || '');
      sessionStorage.setItem('generatedAt', createdAt);

      window.location.href = 'results.html';
    } catch (error) {
      clearInterval(stepTimer);
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      errorBox.innerHTML = `<strong>Generation failed:</strong> ${error.message || 'Something went wrong. Please check the terminal and try again.'}`;
      errorBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-magic"></i> Generate AI Design';
    }
  });
}

function setupResultsPage() {
  const resultImage = $('#resultImage');
  if (!resultImage) return;

  const designData = JSON.parse(sessionStorage.getItem('designData') || '{}');
  const generatedImage = sessionStorage.getItem('generatedImage');
  const beforeImage = sessionStorage.getItem('beforeImage');
  const generatedPrompt = sessionStorage.getItem('generatedPrompt') || 'No prompt saved for this result.';
  const provider = sessionStorage.getItem('generatedProvider') || 'AI provider';
  const isDemo = sessionStorage.getItem('isDemoResult') === 'true';
  const demoMessage = sessionStorage.getItem('demoMessage');

  setTimeout(() => {
    $('#loadingScreen')?.classList.add('hidden');
    $('#resultsContent')?.classList.remove('hidden');
  }, 900);

  if (generatedImage) resultImage.src = generatedImage;
  resultImage.onerror = () => {
    const warning = $('#demoWarning');
    if (warning) {
      warning.textContent = 'The generated image could not be displayed. Please go back and generate another version.';
      warning.classList.remove('hidden');
    }
  };

  const before = $('#beforeImage');
  if (before) before.src = beforeImage || 'images/jason-wang-NxAwryAbtIw-unsplash.jpg';

  const compareBefore = $('#compareBefore');
  const compareAfter = $('#compareAfter');
  if (compareBefore) compareBefore.src = before?.src || 'images/jason-wang-NxAwryAbtIw-unsplash.jpg';
  if (compareAfter) compareAfter.src = generatedImage || resultImage.src;
  setupCompareSlider();

  if (isDemo && $('#demoWarning')) {
    $('#demoWarning').textContent = demoMessage || 'Demo fallback image is shown because live AI generation was not available.';
    $('#demoWarning').classList.remove('hidden');
  }

  const style = formatValue(designData.style || 'Contemporary');
  const color = formatValue(designData.color || 'Neutral Tones');
  const shape = formatValue(designData.shape || 'Curved & Organic');
  const budget = designData.budget ? `EGP ${Number(designData.budget).toLocaleString()}` : 'EGP 5,000';
  const dims = `${designData.length || 12} × ${designData.width || 10} × ${designData.height || 8} ft`;
  const room = formatValue(designData.roomType || 'Living Room');
  const date = new Date(sessionStorage.getItem('generatedAt') || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  $('#resultTitle').textContent = `${room} — ${style}`;
  $('#resultDate').textContent = date;
  if ($('#providerName')) $('#providerName').textContent = formatValue(provider);
  if ($('#promptOutput')) $('#promptOutput').textContent = generatedPrompt;

  const mapping = {
    sumStyle: style, sumColor: color, sumShape: shape, sumBudget: budget, sumDimensions: dims,
    detStyle: style, detColor: color, detShape: shape, detBudget: budget, detDimensions: dims,
    detRoom: room, detMood: formatValue(designData.mood || 'Cozy and Elegant'), detInfo: designData.info || 'Not specified',
  };
  Object.entries(mapping).forEach(([id, value]) => { if ($('#' + id)) $('#' + id).textContent = value; });
}

function downloadResult() {
  const src = sessionStorage.getItem('generatedImage');
  if (!src) return alert('No generated image found.');
  const a = document.createElement('a');
  a.href = src;
  a.download = 'ai-interior-design-result.png';
  a.click();
}

function copyPrompt() {
  const prompt = sessionStorage.getItem('generatedPrompt') || '';
  if (!prompt) return showToast('No prompt found.', 'error');
  navigator.clipboard.writeText(prompt).then(() => showToast('Prompt copied.'));
}

function shareResult() {
  const text = 'Check out my AI interior design result.';
  if (navigator.share) navigator.share({ title: 'AI Interior Design', text, url: location.href });
  else navigator.clipboard.writeText(location.href).then(() => showToast('Result link copied.'));
}

function generateAnotherVersion() {
  window.location.href = 'generate.html';
}

function openEditPage() {
  window.location.href = 'edit.html';
}

function refreshRecommendations() {
  const box = $('#recommendationsList');
  if (!box) return;
  const designData = JSON.parse(sessionStorage.getItem('designData') || '{}');
  const style = formatValue(designData.style || 'your selected style');
  const mood = formatValue(designData.mood || 'cozy mood');
  const ideas = [
    `Add layered lighting to make the ${style} concept feel warmer and more realistic.`,
    `Use one statement piece, then keep the rest of the furniture simple for a cleaner layout.`,
    `Repeat the main colour in small decor items so the room feels connected.`,
    `Keep clear walking space around the main furniture to make the design practical.`,
    `Add soft textures, plants, and wall art to support the ${mood} feeling.`
  ];
  box.innerHTML = ideas.sort(() => Math.random() - 0.5).slice(0, 3).map((idea) => `<li>${idea}</li>`).join('');
  showToast('Recommendations refreshed.');
}

// ============ UPDATED loadHistory FUNCTION ============
async function loadHistory() {
  // Always try to load from Firebase if logged in
  if (isLoggedIn()) {
    try {
      console.log("Loading designs from Firebase...");
      const response = await fetch('/api/designs', { 
        headers: authHeaders(),
        cache: 'no-cache'
      });
      const data = await response.json();
      console.log("Firebase response:", data);
      
      if (response.ok && Array.isArray(data.designs)) {
        console.log(`Loaded ${data.designs.length} designs from Firebase`);
        // Also save to localStorage as backup
        if (data.designs.length > 0) {
          localStorage.setItem('designHistory', JSON.stringify(data.designs));
        }
        return data.designs;
      } else {
        console.warn("No designs from API:", data);
        return [];
      }
    } catch (error) {
      console.error('Dashboard API error:', error.message);
      // Fallback to localStorage
      return safeJSON('designHistory', []);
    }
  }
  // Not logged in - use localStorage
  console.log("Not logged in, loading from localStorage");
  return safeJSON('designHistory', []);
}

// ============ UPDATED setupDashboard FUNCTION ============
function setupDashboard() {
  const grid = $('#historyGrid');
  if (!grid) return;
  let history = [];
  const searchInput = $('#historySearch');
  const styleFilter = $('#styleFilter');
  const total = $('#totalDesigns');
  const latest = $('#latestDesign');
  const providers = $('#providerCount');
  const modeLabel = $('#dashboardMode');

  function render(items) {
    console.log("Rendering items:", items.length);
    
    if (total) total.textContent = items.length;
    if (latest && items[0]) latest.textContent = new Date(items[0].createdAt).toLocaleDateString('en-GB');
    if (providers) providers.textContent = new Set(items.map((item) => item.provider).filter(Boolean)).size || 0;
    if (modeLabel) modeLabel.textContent = isLoggedIn() ? '☁️ Cloud Firestore' : '💻 Browser Local';

    if (!items.length) {
      grid.innerHTML = '<div class="card empty-state"><h3>No saved designs found</h3><p>Generate a new room design to see it here, or adjust your search filters.</p><a class="btn btn-primary" href="generate.html">Start Designing</a></div>';
      return;
    }

    grid.innerHTML = items.map(item => `
      <article class="card history-card">
        <img src="${item.imageUrl}" alt="Saved design" onerror="this.src='images/spacejoy-9M66C_w_ToM-unsplash.jpg'">
        <div class="history-card-body">
          <span class="mini-badge">${formatValue(item.provider || 'AI')}</span>
          ${item.favourite ? '<span class="mini-badge fav-badge"><i class="fas fa-star"></i> Favourite</span>' : ''}
          <h3>${formatValue(item.roomType || 'Room')} — ${formatValue(item.style)}</h3>
          <p>${formatValue(item.color)} · ${new Date(item.createdAt).toLocaleDateString('en-GB')}</p>
          <div class="history-actions">
            <button class="btn btn-soft" onclick="viewSavedDesign('${item.id}')"><i class="fas fa-eye"></i> View</button>
            <button class="btn btn-soft" onclick="toggleFavourite('${item.id}')"><i class="fas fa-star"></i></button>
            <button class="btn btn-danger" onclick="deleteSavedDesign('${item.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </article>
    `).join('');
  }

  function applyFilters() {
    const q = (searchInput?.value || '').toLowerCase().trim();
    const selectedStyle = styleFilter?.value || '';
    const filtered = history.filter((item) => {
      const text = `${item.roomType || ''} ${item.style || ''} ${item.color || ''} ${item.mood || ''} ${item.provider || ''}`.toLowerCase();
      const matchesSearch = !q || text.includes(q);
      const matchesStyle = !selectedStyle || item.style === selectedStyle;
      return matchesSearch && matchesStyle;
    });
    render(filtered);
  }

  // Load history and populate filters
  loadHistory().then((items) => {
    console.log("History loaded, count:", items.length);
    history = items;
    
    // Populate style filter
    if (styleFilter) {
      const styles = [...new Set(history.map((item) => item.style).filter(Boolean))];
      styleFilter.innerHTML = '<option value="">All styles</option>' + styles.map((style) => `<option value="${style}">${formatValue(style)}</option>`).join('');
    }
    
    searchInput?.addEventListener('input', applyFilters);
    styleFilter?.addEventListener('change', applyFilters);
    render(history);
  }).catch(err => {
    console.error("Failed to load history:", err);
    grid.innerHTML = '<div class="card empty-state"><h3>Error Loading Designs</h3><p>Please refresh the page and try again.</p></div>';
  });
}

function viewSavedDesign(id) {
  // Try to find from Firebase data first
  const history = safeJSON('designHistory', []);
  const item = history.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  sessionStorage.setItem('designData', JSON.stringify(item));
  sessionStorage.setItem('generatedImage', item.imageUrl || '');
  sessionStorage.setItem('beforeImage', item.beforeImage || '');
  sessionStorage.setItem('generatedPrompt', item.prompt || '');
  sessionStorage.setItem('generatedProvider', item.provider || 'AI provider');
  sessionStorage.setItem('isDemoResult', item.demo ? 'true' : 'false');
  sessionStorage.setItem('generatedAt', item.createdAt || new Date().toISOString());
  window.location.href = 'results.html';
}

async function toggleFavourite(id) {
  const history = await loadHistory();
  const item = history.find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const next = !item.favourite;
  if (isLoggedIn() && id) {
    try { await fetch(`/api/designs/${id}`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ favourite: next }) }); } catch {}
  } else {
    const local = safeJSON('designHistory', []);
    const target = local.find((entry) => String(entry.id) === String(id));
    if (target) target.favourite = next;
    localStorage.setItem('designHistory', JSON.stringify(local));
  }
  showToast(next ? 'Added to favourites.' : 'Removed from favourites.');
  setTimeout(() => location.reload(), 350);
}

async function deleteSavedDesign(id) {
  if (!confirm('Delete this saved design?')) return;
  if (isLoggedIn() && id) {
    try { await fetch(`/api/designs/${id}`, { method: 'DELETE', headers: authHeaders() }); } catch {}
  }
  const history = safeJSON('designHistory', []);
  localStorage.setItem('designHistory', JSON.stringify(history.filter((item) => String(item.id) !== String(id))));
  showToast('Design removed.');
  setTimeout(() => location.reload(), 500);
}

function clearHistory() {
  if (!confirm('Clear all browser saved designs? Database designs can be deleted one by one.')) return;
  localStorage.removeItem('designHistory');
  location.reload();
}

async function handleLogin(email, password) {
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    showToast('Logged in successfully!');
    setTimeout(() => window.location.href = 'dashboard.html', 500);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleSignup(name, email, password) {
  try {
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    showToast('Account created successfully!');
    setTimeout(() => window.location.href = 'dashboard.html', 500);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function setupAuthForms() {
  const loginForm = $('#loginForm');
  const signupForm = $('#signupForm');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.querySelector('[name="email"]')?.value;
    const password = loginForm.querySelector('[name="password"]')?.value;
    await handleLogin(email, password);
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = signupForm.querySelector('[name="name"]')?.value;
    const email = signupForm.querySelector('[name="email"]')?.value;
    const password = signupForm.querySelector('[name="password"]')?.value;
    await handleSignup(name, email, password);
  });
}

function setupProfilePage() {
  const box = $('#profileBox');
  if (!box) return;
  const user = currentUser();
  if (!user) {
    box.innerHTML = '<h2>You are not logged in</h2><p>Please login to access profile settings and database saved designs.</p><a class="btn btn-primary" href="login.html">Login</a>';
    return;
  }
  $('#profileName').textContent = user.name || '-';
  $('#profileEmail').textContent = user.email || '-';
  $('#profileId').textContent = user.uid || user.id || '-';
}

function setupPromptSuggestions() {
  const chips = $$('.prompt-chip');
  const info = $('#info');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    if (!info) return;
    info.value = chip.dataset.prompt || chip.textContent;
    info.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Prompt suggestion added.');
  }));
}

function setupCompareSlider() {
  const slider = $('#compareRange');
  const afterWrap = $('#compareAfterWrap');
  if (!slider || !afterWrap) return;
  const update = () => { afterWrap.style.clipPath = `inset(0 ${100 - Number(slider.value)}% 0 0)`; };
  slider.addEventListener('input', update);
  update();
}


function setupEditPage() {
  const form = $('#editForm');
  if (!form) return;

  const currentImage = $('#editCurrentImage');
  const currentPrompt = $('#editCurrentPrompt');
  const errorBox = $('#editError');
  const submitBtn = $('#editGenerateBtn');
  const loadingOverlay = $('#generationOverlay');
  const loadingStep = $('#generationStep');

  const generatedImage = sessionStorage.getItem('generatedImage');
  const generatedPrompt = sessionStorage.getItem('generatedPrompt') || '';
  const designData = JSON.parse(sessionStorage.getItem('designData') || '{}');

  if (currentImage && generatedImage) currentImage.src = generatedImage;
  if (currentPrompt) currentPrompt.textContent = generatedPrompt || 'No previous prompt found.';

  if (!generatedImage) {
    if (errorBox) {
      errorBox.textContent = 'No generated design found. Please generate a design first.';
      errorBox.classList.remove('hidden');
    }
    if (submitBtn) submitBtn.disabled = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorBox) errorBox.classList.add('hidden');

    const editPrompt = String(form.elements.editPrompt?.value || '').trim();
    if (!editPrompt) {
      if (errorBox) {
        errorBox.textContent = 'Please write the details you want to change.';
        errorBox.classList.remove('hidden');
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span> Generating edit...';
    }
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (loadingStep) loadingStep.textContent = 'Applying your edit instructions...';

    try {
      const response = await fetch('/api/edit-generate', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          editPrompt,
          previousPrompt: generatedPrompt,
          designData,
          imageUrl: generatedImage,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.imageUrl) {
        throw new Error(data.details || data.error || 'Edit generation failed. Please try again.');
      }

      const nextDesignData = { ...designData, info: editPrompt };
      sessionStorage.setItem('designData', JSON.stringify(nextDesignData));
      sessionStorage.setItem('generatedImage', data.imageUrl);
      sessionStorage.setItem('generatedPrompt', data.prompt || `${generatedPrompt}\n\nEdit requested: ${editPrompt}`);
      sessionStorage.setItem('generatedProvider', data.provider || 'AI provider');
      sessionStorage.setItem('isDemoResult', data.demo ? 'true' : 'false');
      sessionStorage.setItem('demoMessage', data.message || '');
      sessionStorage.setItem('generatedAt', new Date().toISOString());

      window.location.href = 'results.html';
    } catch (error) {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (errorBox) {
        errorBox.innerHTML = `<strong>Edit failed:</strong> ${error.message || 'Something went wrong.'}`;
        errorBox.classList.remove('hidden');
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-magic"></i> Generate Edited Design';
      }
    }
  });
}

function requireLoginNotice() {
  const notice = $('#loginNotice');
  if (notice && !isLoggedIn()) notice.classList.remove('hidden');
}

applyTheme();
updateAuthNav();
setupAuthForms();
setupProfilePage();
setupPromptSuggestions();
requireLoginNotice();
setActiveNav();
setupContactForm();
setupGenerateForm();
setupResultsPage();
setupEditPage();
setupDashboard();