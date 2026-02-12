(function (window) {
  const USERS_KEY = 'relief_users_v2';
  const SESSION_KEY = 'relief_session_v2';

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function now() { return Date.now(); }

  function generateToken() {
    return `${Math.random().toString(36).slice(2)}.${now().toString(36)}`;
  }

  function sanitizeUser(user) {
    const { password, ...safe } = user;
    return safe;
  }

  const AuthSession = {
    signup({ name, email, password, role = 'user' }) {
      const users = read(USERS_KEY, []);
      const normalizedEmail = String(email).trim().toLowerCase();
      if (users.find((u) => u.email === normalizedEmail)) {
        throw new Error('Email already registered.');
      }
      const user = {
        id: `u_${Math.random().toString(36).slice(2, 10)}`,
        name: String(name || '').trim(),
        email: normalizedEmail,
        password: btoa(password),
        role,
        createdAt: new Date().toISOString(),
        emergencyContacts: [],
      };
      users.push(user);
      write(USERS_KEY, users);
      return this.login({ email: normalizedEmail, password });
    },

    login({ email, password }) {
      const users = read(USERS_KEY, []);
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = users.find((u) => u.email === normalizedEmail && u.password === btoa(password));
      if (!user) throw new Error('Invalid email or password.');

      const session = {
        token: generateToken(),
        userId: user.id,
        issuedAt: now(),
        expiresAt: now() + 1000 * 60 * 60 * 24 * 7,
      };
      write(SESSION_KEY, session);
      return { token: session.token, user: sanitizeUser(user) };
    },

    logout() {
      localStorage.removeItem(SESSION_KEY);
    },

    getCurrentUser() {
      const session = read(SESSION_KEY, null);
      if (!session || session.expiresAt < now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      const users = read(USERS_KEY, []);
      const user = users.find((u) => u.id === session.userId);
      return user ? sanitizeUser(user) : null;
    },

    isAuthenticated() {
      return Boolean(this.getCurrentUser());
    },

    requireAuth(redirect = '../pages/login.html') {
      if (!this.isAuthenticated()) {
        window.location.href = redirect;
        return false;
      }
      return true;
    },

    hasRole(role) {
      const user = this.getCurrentUser();
      return user && user.role === role;
    },

    bindNavAuthState() {
      const user = this.getCurrentUser();
      document.querySelectorAll('.btn-login').forEach((el) => {
        el.style.display = user ? 'none' : '';
      });
      document.querySelectorAll('.btn-signup').forEach((el) => {
        el.style.display = user ? 'none' : '';
      });

      const existing = document.querySelector('.relief-user-menu');
      if (existing) existing.remove();

      if (user) {
        const navRight = document.querySelector('.navbar-right .nav-links') || document.querySelector('.nav-links');
        if (navRight) {
          const li = document.createElement('li');
          li.className = 'relief-user-menu';
          li.innerHTML = `<a href="${location.pathname.includes('/pages/') ? './dashboard.html' : 'pages/dashboard.html'}">👤 ${user.name || 'User'}</a> <a href="#" class="btn-logout" style="margin-left:10px">Logout</a>`;
          navRight.appendChild(li);
          li.querySelector('.btn-logout').addEventListener('click', (e) => {
            e.preventDefault();
            this.logout();
            window.location.href = location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
          });
        }
      }
    },
  };

  window.AuthSession = AuthSession;
})(window);
