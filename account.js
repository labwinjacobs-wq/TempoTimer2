const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.TEMPO_CONFIG;
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authView = document.getElementById('authView');
const accountView = document.getElementById('accountView');
const emailForm = document.getElementById('emailForm');
const googleButton = document.getElementById('googleButton');
const switchMode = document.getElementById('switchMode');
const authMessage = document.getElementById('authMessage');

let isSignInMode = false;

function showMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.style.color = isError ? '#d9381e' : '#141414';
}

function setMode(signIn) {
  isSignInMode = signIn;
  document.querySelector('#authView h1').textContent = signIn ? 'Sign in' : 'Make an account';
  document.getElementById('authIntro').textContent = signIn
    ? 'Welcome back. Sign in to get to your tasks.'
    : 'Your tasks and timer history will be saved and available on any device you sign in on.';
  emailForm.querySelector('button').textContent = signIn ? 'Sign in' : 'Create account';
  document.getElementById('password').autocomplete = signIn ? 'current-password' : 'new-password';
  switchMode.textContent = signIn ? 'New here? Make an account' : 'Already have an account? Sign in';
  showMessage('');
}

switchMode.addEventListener('click', () => setMode(!isSignInMode));

googleButton.addEventListener('click', async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
  });
  if (error) showMessage(error.message, true);
});

emailForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const result = isSignInMode
    ? await supabaseClient.auth.signInWithPassword({ email, password })
    : await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
      });

  if (result.error) {
    showMessage(result.error.message, true);
    return;
  }
  showMessage(isSignInMode ? 'Signed in.' : 'Check your inbox for a confirmation link.');
  if (isSignInMode) loadAccount();
});

document.getElementById('signOutButton').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  accountView.classList.add('hidden');
  authView.classList.remove('hidden');
  setMode(true);
});

document.getElementById('calendarButton').addEventListener('click', () => {
  alert('Calendar connection isn’t available yet.');
});

async function loadAccount() {
  let user = null;
  try {
    const { data } = await supabaseClient.auth.getUser();
    user = data.user;
  } catch (e) { /* not signed in or offline */ }

  if (!user) {
    accountView.classList.add('hidden');
    authView.classList.remove('hidden');
    return;
  }

  authView.classList.add('hidden');
  accountView.classList.remove('hidden');

  const name = user.user_metadata?.full_name || user.email.split('@')[0];
  document.getElementById('welcomeName').textContent = `Hi, ${name}.`;
  document.getElementById('accountEmail').textContent = user.email;

  const { count } = await supabaseClient
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('completed', false);
  document.getElementById('openTaskCount').textContent = count || 0;

  const { data: sessions } = await supabaseClient
    .from('focus_sessions')
    .select('duration_minutes')
    .eq('completed', true);
  document.getElementById('focusMinutes').textContent =
    (sessions || []).reduce((n, x) => n + x.duration_minutes, 0);
}

supabaseClient.auth.onAuthStateChange(loadAccount);
loadAccount();
