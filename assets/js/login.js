document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('login-form');
  if (window.AuthSession && AuthSession.isAuthenticated()) {
    window.location.href = './dashboard.html';
    return;
  }

  form?.addEventListener('submit', function (e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = form.querySelector('button[type="submit"]');

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
      AuthSession.login({ email, password });
      showAlert('success', 'Login successful. Redirecting to dashboard...');
      setTimeout(() => { window.location.href = './dashboard.html'; }, 700);
    } catch (err) {
      showAlert('danger', err.message || 'Login failed.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
    }
  });
});

function showAlert(type, message) {
  document.querySelector('.alert')?.remove();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  document.getElementById('login-form')?.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}
