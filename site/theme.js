(() => {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let explicit = null;
  try {
    const stored = localStorage.getItem('atc-theme');
    if (['light', 'dark'].includes(stored)) explicit = stored;
  } catch {}
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const button = document.getElementById('themeButton');
    if (button) {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.textContent = theme === 'dark' ? '☼' : '☾';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101e30' : '#f2f5f9');
  }
  applyTheme(explicit || (preference.matches ? 'dark' : 'light'));
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.dataset.theme);
    document.getElementById('themeButton')?.addEventListener('click', () => {
      explicit = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('atc-theme', explicit); } catch {}
      applyTheme(explicit);
    });
  });
  preference.addEventListener('change', event => { if (!explicit) applyTheme(event.matches ? 'dark' : 'light'); });
})();
