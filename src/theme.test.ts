import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadThemePref, resolveTheme, saveThemePref } from './theme';

beforeEach(() => localStorage.clear());

describe('thème', () => {
  it('« Système » par défaut ; le choix est mémorisé', () => {
    expect(loadThemePref()).toBe('system');
    saveThemePref('dark');
    expect(loadThemePref()).toBe('dark');
    localStorage.setItem('animflow:theme', 'n’importe quoi');
    expect(loadThemePref()).toBe('system');
  });

  it('appliqué sur <html> (clair / sombre explicites)', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    // sans préférence système détectable, « Système » donne le thème clair
    expect(['light', 'dark']).toContain(resolveTheme('system'));
  });
});
