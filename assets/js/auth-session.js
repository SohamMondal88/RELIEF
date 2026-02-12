(function (window) {
  const USERS_KEY = 'relief_users_v3';
  const SESSION_KEY = 'relief_session_v3';

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  const now = () => Date.now();

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function randomToken() {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function sanitizeUser(user) { const { passwordHash, ...safe } = user; return safe; }

  const AuthSession = {
    async signup({ name, email, password, role = 'user' }) {
      const users = read(USERS_KEY, []);
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail || !password || password.length < 6) throw new Error('Invalid signup data.');
      if (users.find((u) => u.email === normalizedEmail)) throw new Error('Email already registered.');

      const user = {
        id: `u_${crypto.randomUUID().slice(0, 8)}`,
        name: String(name || '').trim() || 'RELIEF User',
        email: normalizedEmail,
        passwordHash: await sha256(password),
        role,
        createdAt: new Date().toISOString(),
        emergencyContacts: []
      };
      users.push(user);
      write(USERS_KEY, users);
      return this.login({ email: normalizedEmail, password });
    },

    async login({ email, password }) {
      const users = read(USERS_KEY, []);
      const normalizedEmail = String(email).trim().toLowerCase();
      const passHash = await sha256(password || '');
      const user = users.find((u) => u.email === normalizedEmail && u.passwordHash === passHash);
      if (!user) throw new Error('Invalid email or password.');

      const session = {
        token: randomToken(),
        userId: user.id,
        issuedAt: now(),
        expiresAt: now() + 1000 * 60 * 60 * 24 * 7,
      };
      write(SESSION_KEY, session);
      return { token: session.token, user: sanitizeUser(user) };
    },

    logout() { localStorage.removeItem(SESSION_KEY); },

    getCurrentUser() {
      const session = read(SESSION_KEY, null);
      if (!session || session.expiresAt < now()) { localStorage.removeItem(SESSION_KEY); return null; }
      const users = read(USERS_KEY, []);
      const user = users.find((u) => u.id === session.userId);
      return user ? sanitizeUser(user) : null;
    },

    isAuthenticated() { return Boolean(this.getCurrentUser()); },
    requireAuth(redirect = '../pages/login.html') {
      if (!this.isAuthenticated()) { window.location.href = redirect; return false; }
      return true;
    },
    hasRole(role) {
      const user = this.getCurrentUser();
      return Boolean(user && user.role === role);
    },

    bindNavAuthState() {
      const user = this.getCurrentUser();
      document.querySelectorAll('.btn-login').forEach((el) => { el.style.display = user ? 'none' : ''; });
      document.querySelectorAll('.btn-signup').forEach((el) => { el.style.display = user ? 'none' : ''; });

      document.querySelector('.relief-user-menu')?.remove();
      if (!user) return;

      const navRight = document.querySelector('.navbar-right .nav-links') || document.querySelector('.nav-links');
      if (!navRight) return;
      const li = document.createElement('li');
      const dashboardHref = location.pathname.includes('/pages/') ? './dashboard.html' : 'pages/dashboard.html';
      const homeHref = location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
      li.className = 'relief-user-menu';
      li.innerHTML = `<a href="${dashboardHref}">👤 ${user.name}</a> <a href="#" class="btn-logout" style="margin-left:10px">Logout</a>`;
      navRight.appendChild(li);
      li.querySelector('.btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        this.logout();
        window.location.href = homeHref;
      });
    }
  };

  window.AuthSession = AuthSession;
})(window);
