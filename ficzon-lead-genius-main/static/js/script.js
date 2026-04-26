// ── Dynamic column metadata (set after upload) ──────────────────────────
let _columns = [];
let _chartCols = [];
let _colMap = {};
let charts = {};
let lastUploadResult = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchLeads();
    updateFormCategories();
    initChatDraggable();
});


function renderLeadsTable(leads) {
    const tbody = document.getElementById('leads-table-body');
    const thead = document.querySelector('#leadsTable thead tr');
    tbody.innerHTML = '';

    // Build headers from actual CSV columns + Score + Status + Actions
    const displayCols = _columns.length ? _columns : Object.keys(leads[0] || {}).filter(k => !k.startsWith('_'));
    thead.innerHTML = displayCols.map(c => `<th>${c}</th>`).join('') +
                      '<th>Score</th><th>Status</th><th>Actions</th>';

    leads.forEach(lead => {
        const score = lead._score ?? lead.score ?? 50;
        const status = lead._status ?? lead.status ?? 'Cold';
        const sc = score >= 80 ? 'hot' : score >= 50 ? 'warm' : 'cold';
        const id = lead._id ?? lead.id ?? '';
        const name = lead._name ?? '';

        const cells = displayCols.map(c => `<td>${lead[c] ?? ''}</td>`).join('');
        const tr = document.createElement('tr');
        tr.innerHTML = cells +
            `<td><span class="score-pill score-${sc}">${score}</span></td>` +
            `<td><span class="status-badge status-${status.toLowerCase()}"><span class="status-dot"></span>${status}</span></td>` +
            `<td><button class="section-link" style="background:none;border:none;padding:0;" onclick="openEditModal('${id}','${name}','','')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
             </button></td>`;
        tbody.appendChild(tr);
    });
}

async function fetchLeads() {
    try {
        const response = await fetch('/api/leads');
        const leads = await response.json();

        renderLeadsTable(leads);
        updateCharts(leads);

        // Update Stats
        const hotCount  = leads.filter(l => (l._status ?? l.status) === 'Hot').length;
        const coldCount = leads.filter(l => (l._status ?? l.status) === 'Cold').length;
        const avgScore  = leads.length > 0
            ? (leads.reduce((s, l) => s + (l._score ?? l.score ?? 0), 0) / leads.length).toFixed(1)
            : 0;

        document.getElementById('stat-total-leads').innerText = leads.length;
        document.getElementById('stat-hot-leads').innerText   = hotCount;
        document.getElementById('stat-avg-score').innerText   = avgScore;
        document.getElementById('stat-cold-leads').innerText  = coldCount;
        document.getElementById('sidebar-badge').innerText    = hotCount;

    } catch (error) {
        console.error('Error fetching leads:', error);
    }
}

// Upload Handling
const fileInput  = document.getElementById('file-upload');
const dropzone   = document.getElementById('dropzone');
const processBtn = document.getElementById('process-upload');

if (dropzone) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            document.getElementById('file-info').innerText = `Selected: ${fileInput.files[0].name}`;
            processBtn.style.display = 'flex';
        }
    });
}

if (processBtn) {
    processBtn.addEventListener('click', async () => {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        processBtn.disabled = true;
        processBtn.innerText = 'Analyzing...';

        try {
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Upload failed');
            }
            const result = await response.json();
            lastUploadResult = result;

            // Store dynamic column metadata
            _columns   = result.columns   || [];
            _chartCols = result.chart_cols || [];
            _colMap    = result.col_map    || {};

            document.getElementById('report-summary').classList.remove('hidden');
            fetchLeads();
            updateFormCategories();
        } catch (err) {
            console.error('Upload Error:', err);
            alert('Failed to process file: ' + err.message);
        } finally {
            processBtn.disabled = false;
            processBtn.innerText = 'Process Data';
        }
    });
}

function updateCharts(leads) {
    // Use detected categorical columns, fall back to first 2 if none
    const cat1 = _chartCols[0] || _colMap.source || 'Source';
    const cat2 = _chartCols[1] || _colMap.location || 'Location';

    // Chart 1: Doughnut — first categorical column
    const cat1Counts = {};
    leads.forEach(l => {
        const v = String(l[cat1] || l['_source'] || l['Source'] || 'Other');
        cat1Counts[v] = (cat1Counts[v] || 0) + 1;
    });
    const cat1Labels = Object.keys(cat1Counts);
    const cat1Data   = Object.values(cat1Counts);

    if (charts.sources) charts.sources.destroy();
    charts.sources = new Chart(document.getElementById('sourcesChart'), {
        type: 'doughnut',
        data: {
            labels: cat1Labels.length ? cat1Labels : ['No Data'],
            datasets: [{
                data: cat1Data.length ? cat1Data : [1],
                backgroundColor: cat1Data.length
                    ? ['#7c3aed','#06b6d4','#ec4899','#f59e0b','#22c55e','#f97316','#8b5cf6']
                    : ['#e5e7eb'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: {
                legend: { display: true, position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 11 } } },
                title: { display: true, text: cat1, color: '#94a3b8', font: { size: 12 } }
            }
        }
    });

    // Chart 2: Bar — second categorical column
    const cat2Counts = {};
    leads.forEach(l => {
        const v = String(l[cat2] || l['_location'] || l['Location'] || 'Other');
        cat2Counts[v] = (cat2Counts[v] || 0) + 1;
    });
    const cat2Labels = Object.keys(cat2Counts);
    const cat2Data   = Object.values(cat2Counts);

    if (charts.locations) charts.locations.destroy();
    charts.locations = new Chart(document.getElementById('locationsChart'), {
        type: 'bar',
        data: {
            labels: cat2Labels.length ? cat2Labels : ['No Data'],
            datasets: [{
                label: cat2,
                data: cat2Data.length ? cat2Data : [0],
                backgroundColor: 'rgba(124,58,237,0.7)',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: cat2, color: '#94a3b8', font: { size: 12 } }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }
            }
        }
    });

    // Chart 3: Line — lead score distribution
    if (charts.trends) charts.trends.destroy();
    charts.trends = new Chart(document.getElementById('leadsChart'), {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Conversions',
                data: [42, 58, 51, 73, 68, 89],
                borderColor: '#7c3aed',
                backgroundColor: 'rgba(124,58,237,0.08)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}


// Prediction Form
const predictionForm = document.getElementById('prediction-form');
if (predictionForm) {
    predictionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(predictionForm);
        const data = Object.fromEntries(formData.entries());
        const btn = document.getElementById('score-btn');
        
        btn.innerHTML = '<svg class="fa-spin" style="animation: spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> Scoring...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            
            const resScore = document.getElementById('res-score');
            const resStatusPill = document.getElementById('res-status-pill');
            
            resScore.innerText = result.score;
            resStatusPill.innerHTML = `<span class="status-badge status-${result.status.toLowerCase()}"><span class="status-dot"></span>${result.status}</span>`;
            
            document.getElementById('prediction-result').classList.remove('hidden');
            fetchLeads();
        } catch (err) {
            console.error(err);
        } finally {
            btn.innerHTML = 'Score Lead <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>';
            btn.disabled = false;
        }
    });
}

async function updateFormCategories() {
    try {
        const response = await fetch('/api/categories');
        const cats = await response.json();
        
        const updateSelect = (name, values) => {
            const select = document.querySelector(`select[name="${name}"]`);
            if (!select) return;
            select.innerHTML = '';
            values.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                select.appendChild(opt);
            });
        };

        if (cats.Source) updateSelect('Source', cats.Source);
        if (cats.Location) updateSelect('Location', cats.Location);
        if (cats.Delivery_Mode) updateSelect('Delivery_Mode', cats.Delivery_Mode);
        
        // Product ID input handling
        if (cats.Product_ID && cats.Product_ID.length > 0) {
            const pidInput = document.querySelector('input[name="Product_ID"]');
            if (pidInput) pidInput.placeholder = `e.g. ${cats.Product_ID[0]}`;
        }
    } catch (err) { console.error('Error updating categories:', err); }
}


// Search Filter
document.getElementById('searchInput').addEventListener('input', function() {
    const q = this.value.toLowerCase();
    const rows = document.querySelectorAll('#leads-table-body tr');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
    });
});

// Chatbot Logic
const chatToggle = document.getElementById('chatbot-toggle');
const chatWindow = document.getElementById('chat-window');
const chatInput = document.getElementById('chat-input');
const sendChat = document.getElementById('send-chat');
const chatMessages = document.getElementById('chat-messages');

chatToggle.addEventListener('click', () => chatWindow.classList.toggle('hidden'));
document.getElementById('close-chat').addEventListener('click', () => chatWindow.classList.add('hidden'));

async function handleSendMessage(q) {
    const text = q || chatInput.value.trim();
    if (!text) return;

    appendMessage(text, 'user');
    chatInput.value = '';
    document.getElementById('chipArea').style.display = 'none';

    const ti = showTyping();
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        const data = await response.json();
        ti.remove();
        appendMessage(data.response, 'bot');
    } catch (err) { ti.remove(); appendMessage("Sorry, I'm offline.", 'bot'); }
}

function appendMessage(text, sender) {
    const d = document.createElement('div');
    d.className = `msg ${sender}`;
    d.innerHTML = `<div class="msg-bubble">${text}</div>`;
    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTyping() {
    const d = document.createElement('div');
    d.className = 'msg bot';
    d.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return d;
}

chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendMessage(); });
sendChat.addEventListener('click', () => handleSendMessage());
document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => handleSendMessage(chip.dataset.q));
});

// Sidebar Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelector('.nav-item.active').classList.remove('active');
        item.classList.add('active');
        const target = item.dataset.target;
        const section = document.getElementById(`${target}-section`) || document.getElementById(`${target}-area`);
        if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
});

// Modal Logic
function openEditModal(id, name, company, value) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = name;
    document.getElementById('edit-company').value = company;
    document.getElementById('edit-value').value = value;
    document.getElementById('edit-modal').classList.add('active');
}

document.getElementById('close-modal-btn').addEventListener('click', () => {
    document.getElementById('edit-modal').classList.remove('active');
});

// Edit Form Submit
document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const payload = {
        name: document.getElementById('edit-name').value,
        company: document.getElementById('edit-company').value,
        value: document.getElementById('edit-value').value
    };
    try {
        const res = await fetch(`/api/leads/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            document.getElementById('edit-modal').classList.remove('active');
            fetchLeads();
        } else {
            alert('Failed to update lead.');
        }
    } catch (err) {
        console.error('Edit error:', err);
        alert('Error updating lead.');
    }
});

// Download Report
const dlBtn = document.getElementById('download-report');
if (dlBtn) {
    dlBtn.addEventListener('click', () => {
        if (!lastUploadResult) return alert('No report data yet. Upload a file first.');
        const blob = new Blob([JSON.stringify(lastUploadResult, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ficzon_report.json';
        a.click();
        URL.revokeObjectURL(url);
    });
}


// Draggable Chat
function initChatDraggable() {
    const header = document.querySelector('.chat-header');
    let isDragging = false;
    let initialX, initialY, xOffset = 0, yOffset = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('#close-chat')) return;
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        isDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            xOffset = e.clientX - initialX;
            yOffset = e.clientY - initialY;
            chatWindow.style.transform = `translate3d(${xOffset}px, ${yOffset}px, 0)`;
        }
    });

    document.addEventListener('mouseup', () => { isDragging = false; });
}