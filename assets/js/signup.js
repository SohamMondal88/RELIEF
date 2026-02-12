document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('signup-form');
  if (window.AuthSession && AuthSession.isAuthenticated()) {
    window.location.href = './dashboard.html';
    return;
  }

  form?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;

    if (password !== confirmPassword) {
      showAlert('danger', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      showAlert('danger', 'Password must be at least 6 characters.');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';
      await AuthSession.signup({ name, email, password, role: 'user' });
      showAlert('success', 'Account created. Redirecting to dashboard...');
      setTimeout(() => { window.location.href = './dashboard.html'; }, 700);
    } catch (err) {
      showAlert('danger', err.message || 'Signup failed.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign Up';
    }
  });
});

function showAlert(type, message) {
  document.querySelector('.alert')?.remove();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  document.getElementById('signup-form')?.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}
