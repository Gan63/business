// ── Dynamic column metadata (set after upload) ──────────────────────────
let _columns = [];
let _chartCols = [];
let _colMap = {};
let charts = {};
let lastUploadResult = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchLeads();
    updateFormCategories();
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
    if (!leads || leads.length === 0) return;
    
    const colors = {
        blue: '#378ADD',
        teal: '#1D9E75',
        amber: '#BA7517',
        pink: '#D4537E',
        red: '#E24B4A',
        grid: '#333333'
    };
    Chart.defaults.color = '#A0A0A0';
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    // Auto-detect columns based on regex
    const cols = Object.keys(leads[0]);
    const getCol = (regex) => cols.find(c => regex.test(c));
    
    const salesCol = getCol(/sales|revenue|amount|value|price/i) || null;
    const profitCol = getCol(/profit|margin/i) || salesCol;
    const dateCol = getCol(/date|time|year|month/i) || null;
    
    const catCol = getCol(/category|type|industry|dept/i) || cols[Math.min(1, cols.length-1)];
    const regionCol = getCol(/region|city|state|location/i) || cols[Math.min(2, cols.length-1)];
    const segCol = getCol(/segment|customer|role/i) || cols[Math.min(3, cols.length-1)];
    const subCatCol = getCol(/sub.category|product|item/i) || cols[Math.min(4, cols.length-1)];

    // Format helpers
    const formatCurrency = (val) => {
        if (Math.abs(val) >= 1000000) return '$' + (val / 1000000).toFixed(2) + 'M';
        if (Math.abs(val) >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
        return '$' + val.toFixed(0);
    };

    // Calculate KPIs
    let totalSales = 0, totalProfit = 0;
    const hasProfitCol = !!profitCol && profitCol !== salesCol;
    
    leads.forEach(l => {
        if (salesCol) {
            let s = String(l[salesCol]).replace(/[^0-9.-]+/g, "");
            totalSales += parseFloat(s) || 0;
        }
        if (hasProfitCol) {
            let p = String(l[profitCol]).replace(/[^0-9.-]+/g, "");
            totalProfit += parseFloat(p) || 0;
        }
    });

    const totalOrders = leads.length;
    const profitMargin = (hasProfitCol && totalSales) ? (totalProfit / totalSales) * 100 : 0;

    const kpiElements = document.querySelectorAll('.kpi-value');
    if (kpiElements.length >= 4) {
        kpiElements[0].innerText = formatCurrency(totalSales);
        kpiElements[1].innerText = hasProfitCol ? formatCurrency(totalProfit) : '--';
        kpiElements[2].innerText = hasProfitCol ? profitMargin.toFixed(1) + '%' : '--';
        kpiElements[3].innerText = totalOrders >= 1000 ? (totalOrders/1000).toFixed(2) + 'K' : totalOrders;
    }

    // Aggregation Helper
    const aggregate = (col, valCol) => {
        const counts = {};
        leads.forEach(l => {
            const k = l[col] || 'Other';
            const v = valCol ? (parseFloat(l[valCol]) || 0) : 1;
            counts[k] = (counts[k] || 0) + v;
        });
        return counts;
    };

    const sortObject = (obj, topN, bottomN = 0) => {
        let entries = Object.entries(obj).sort((a,b) => b[1] - a[1]);
        if (bottomN > 0) {
             entries = [...entries.slice(0, topN), ...entries.slice(-bottomN)];
        } else {
             entries = entries.slice(0, topN);
        }
        return entries.reduce((acc, [k,v]) => { acc.keys.push(k); acc.values.push(v); return acc; }, {keys:[], values:[]});
    };

    // --- 1. Category Chart (Donut) ---
    const catData = sortObject(aggregate(catCol, salesCol), 4);
    if (charts.categoryChart) charts.categoryChart.destroy();
    charts.categoryChart = new Chart(document.getElementById('categoryChart'), {
        type: 'doughnut',
        data: {
            labels: catData.keys.length ? catData.keys : ['No Data'],
            datasets: [{
                data: catData.values.length ? catData.values : [1],
                backgroundColor: [colors.blue, colors.amber, colors.teal, colors.pink],
                borderWidth: 0, hoverOffset: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
    });

    // --- 2. Region Chart (Bar) ---
    const regionData = sortObject(aggregate(regionCol, salesCol), 5);
    if (charts.regionChart) charts.regionChart.destroy();
    charts.regionChart = new Chart(document.getElementById('regionChart'), {
        type: 'bar',
        data: {
            labels: regionData.keys,
            datasets: [{ data: regionData.values, backgroundColor: colors.blue }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: colors.grid }, beginAtZero: true } } }
    });

    // --- 3. Segment Chart (Donut) ---
    const segData = sortObject(aggregate(segCol, null), 3); // count by segment
    if (charts.segmentChart) charts.segmentChart.destroy();
    charts.segmentChart = new Chart(document.getElementById('segmentChart'), {
        type: 'doughnut',
        data: {
            labels: segData.keys,
            datasets: [{
                data: segData.values,
                backgroundColor: [colors.teal, colors.blue, colors.pink],
                borderWidth: 0, hoverOffset: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
    });

    // --- 4. Sub-Category Profit (Horizontal Bar) ---
    const profitData = sortObject(aggregate(subCatCol, profitCol), 4, 3); // Top 4 and Bottom 3
    if (charts.profitChart) charts.profitChart.destroy();
    charts.profitChart = new Chart(document.getElementById('profitChart'), {
        type: 'bar',
        data: {
            labels: profitData.keys,
            datasets: [{
                data: profitData.values,
                backgroundColor: (ctx) => ctx.raw > 0 ? colors.teal : colors.red
            }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { grid: { color: colors.grid } }, y: { grid: { display: false } } } }
    });

    // --- 5. Trend Chart (Line) ---
    let trendKeys = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let trendSales = [42000, 31000, 55000, 36000, 44000, 52000, 45000, 63000, 87000, 77000, 118000, 83000];
    let trendProfit = [8000, 4000, 9000, 5000, 7000, 8000, 6000, 9000, 13000, 11000, 17000, 14000];

    if (dateCol) {
        // Simple aggregate by month if date column exists
        const monthSales = {}, monthProfit = {};
        leads.forEach(l => {
            const d = new Date(l[dateCol]);
            if (!isNaN(d)) {
                const m = d.toLocaleString('default', { month: 'short' });
                monthSales[m] = (monthSales[m] || 0) + (parseFloat(l[salesCol]) || 0);
                monthProfit[m] = (monthProfit[m] || 0) + (parseFloat(l[profitCol]) || 0);
            }
        });
        if (Object.keys(monthSales).length > 0) {
            trendKeys = Object.keys(monthSales);
            trendSales = trendKeys.map(m => monthSales[m]);
            trendProfit = trendKeys.map(m => monthProfit[m]);
        }
    }

    if (charts.trendChart) charts.trendChart.destroy();
    charts.trendChart = new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
            labels: trendKeys,
            datasets: [
                { label: 'Sales', data: trendSales, borderColor: colors.blue, backgroundColor: colors.blue + '20', fill: true, tension: 0.4 },
                { label: 'Profit', data: trendProfit, borderColor: colors.teal, backgroundColor: 'transparent', tension: 0.4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false, color: colors.grid } }, y: { grid: { color: colors.grid }, beginAtZero: true } } }
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

