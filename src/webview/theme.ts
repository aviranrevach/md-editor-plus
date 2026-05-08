export type ThemeSetting = 'auto' | 'light' | 'dark';

let _currentSetting: ThemeSetting = 'auto';

function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast-dark')
    ? 'dark'
    : 'light';
}

function updateThemeButton(resolved: 'light' | 'dark'): void {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  if (_currentSetting === 'auto') {
    btn.textContent = `Auto (${resolved === 'dark' ? '🌙' : '☀️'})`;
  } else {
    btn.textContent = resolved === 'dark' ? '🌙 Dark' : '☀️ Light';
  }
}

export function applyTheme(setting: ThemeSetting): void {
  _currentSetting = setting;
  const resolved = resolveTheme(setting);
  document.documentElement.classList.toggle('theme-dark', resolved === 'dark');
  updateThemeButton(resolved);
}

export function initTheme(setting: ThemeSetting): void {
  applyTheme(setting);
  const observer = new MutationObserver(() => {
    if (_currentSetting === 'auto') applyTheme('auto');
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export function cycleTheme(): ThemeSetting {
  const next: Record<ThemeSetting, ThemeSetting> = {
    auto: 'light',
    light: 'dark',
    dark: 'auto',
  };
  const newSetting = next[_currentSetting];
  applyTheme(newSetting);
  return newSetting;
}
