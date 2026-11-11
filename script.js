const $ = s => document.querySelector(s);

const config = window.TEMPO_CONFIG;
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase not available, running in guest mode.', e);
}

const today = new Date();
$('#todayDate').textContent = today.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
$('#year').textContent = today.getFullYear();

let tasks = [];

// Returns the signed-in user, or null (also null if Supabase can't be reached).
async function user() {
  if (!supabaseClient) return null;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
  } catch (e) {
    return null;
  }
}

function saveGuest() {
  localStorage.setItem('tempo-guest-tasks', JSON.stringify(tasks));
}

async function loadTasks() {
  const u = await user();
  if (!u) {
    tasks = JSON.parse(localStorage.getItem('tempo-guest-tasks') || '[]');
    render();
    return;
  }
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .order('completed')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error.message);
    return;
  }
  tasks = data || [];
  render();
}

function render() {
  window.TempoTasks = tasks;
  document.dispatchEvent(new Event('tempo:tasks'));
  const list = $('#taskList');
  list.innerHTML = '';

  const open = tasks.filter(t => !(t.completed ?? t.done));
  const mins = open.reduce((n, t) => n + Number(t.estimated_minutes || t.duration || 0), 0);

  if (!tasks.length) {
    $('#taskSummary').textContent = 'Nothing here yet.';
  } else {
    const h = Math.floor(mins / 60), m = mins % 60;
    const total = h ? `${h}h ${m}m` : `${m}m`;
    $('#taskSummary').textContent = `${open.length} open, ${total} planned`;
  }

  tasks.forEach(t => {
    const done = t.completed ?? t.done;
    const li = document.createElement('li');
    li.className = 'task-item' + (done ? ' done' : '');
    li.innerHTML =
      `<input type="checkbox" ${done ? 'checked' : ''} aria-label="Done">` +
      `<span class="task-name"></span>` +
      `<span class="task-meta">${Number(t.estimated_minutes || t.duration)}m</span>` +
      `<span class="tag"></span>` +
      `<button class="delete-task" type="button" aria-label="Delete task">×</button>`;
    li.querySelector('.task-name').textContent = t.title || t.name;
    li.querySelector('.tag').textContent = t.priority;
    li.querySelector('input').addEventListener('change', () => toggleTask(t, !done));
    li.querySelector('.delete-task').addEventListener('click', () => removeTask(t));
    list.appendChild(li);
  });
}

async function addTask(title, duration, priority) {
  const u = await user();
  if (!u) {
    tasks.unshift({ id: crypto.randomUUID(), name: title, duration, priority, done: false });
    saveGuest();
    render();
    return;
  }
  const { error } = await supabaseClient
    .from('tasks')
    .insert({ user_id: u.id, title, estimated_minutes: duration, priority });
  if (error) alert(error.message);
  else loadTasks();
}

async function toggleTask(t, done) {
  const u = await user();
  if (!u) {
    t.done = done;
    saveGuest();
    render();
    return;
  }
  await supabaseClient.from('tasks').update({
    completed: done,
    completed_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq('id', t.id);
  loadTasks();
}

async function removeTask(t) {
  const u = await user();
  if (!u) {
    tasks = tasks.filter(x => x.id !== t.id);
    saveGuest();
    render();
    return;
  }
  await supabaseClient.from('tasks').delete().eq('id', t.id);
  loadTasks();
}

$('#taskForm').addEventListener('submit', e => {
  e.preventDefault();
  addTask($('#taskName').value.trim(), Number($('#taskDuration').value), $('#taskPriority').value);
  e.target.reset();
  $('#taskDuration').value = 45;
});

$('#clearTasks').addEventListener('click', async () => {
  if (!tasks.length || !confirm('Remove every task on the list?')) return;
  const u = await user();
  if (!u) {
    tasks = [];
    localStorage.removeItem('tempo-guest-tasks');
    render();
    return;
  }
  await supabaseClient.from('tasks').delete().in('id', tasks.map(t => t.id));
  loadTasks();
});

/* ---------- friday checklist (remembered in this browser) ---------- */

const reviewBoxes = document.querySelectorAll('[data-review]');
const reviewKey = 'tempo-review-checks';

function loadReview() {
  try {
    const saved = JSON.parse(localStorage.getItem(reviewKey) || '[]');
    reviewBoxes.forEach((box, i) => { box.checked = !!saved[i]; });
  } catch (e) { /* ignore */ }
}

function saveReview() {
  try {
    localStorage.setItem(reviewKey, JSON.stringify([...reviewBoxes].map(b => b.checked)));
  } catch (e) { /* ignore */ }
}

reviewBoxes.forEach(box => box.addEventListener('change', saveReview));
$('#resetReview').addEventListener('click', () => {
  reviewBoxes.forEach(b => { b.checked = false; });
  saveReview();
});

loadReview();
loadTasks();
