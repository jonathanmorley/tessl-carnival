import { describe, expect, it } from 'vitest';
import { carnivalLink, forkRepo, MAX_IDEA_LENGTH, shareLinks, suggestGameLink } from './share';

describe('carnivalLink', () => {
  it('shares the carnival page without the game route or query', () => {
    expect(carnivalLink('https://ada.github.io/tessl-carnival/?x=1#/play/water-cannon')).toBe(
      'https://ada.github.io/tessl-carnival/',
    );
  });

  it('has nothing to share on a local or preview server', () => {
    expect(carnivalLink('http://localhost:5173/')).toBeUndefined();
    expect(carnivalLink('https://127.0.0.1:5173/')).toBeUndefined();
    expect(carnivalLink('https://ada-carnival-5173.app.github.dev/')).toBeUndefined();
  });
});

describe('shareLinks', () => {
  it('puts the carnival link in both posts', () => {
    const links = shareLinks('https://ada.github.io/tessl-carnival/');
    const x = new URL(links.x);
    expect(x.hostname).toBe('x.com');
    expect(x.searchParams.get('url')).toBe('https://ada.github.io/tessl-carnival/');
    expect(x.searchParams.get('text')).toContain('@tessl_io');
    expect(new URL(links.linkedIn).searchParams.get('url')).toBe(
      'https://ada.github.io/tessl-carnival/',
    );
  });
});

describe('forkRepo', () => {
  it('finds the repository behind a GitHub Pages carnival', () => {
    expect(forkRepo('https://ada.github.io/tessl-carnival/#/play/x')).toBe(
      'https://github.com/ada/tessl-carnival',
    );
    expect(forkRepo('https://Ada-Lovelace.github.io/my-fair/')).toBe(
      'https://github.com/ada-lovelace/my-fair',
    );
    // A user site at the root is the <owner>.github.io repository.
    expect(forkRepo('https://ada.github.io/')).toBe('https://github.com/ada/ada.github.io');
  });

  it("doesn't guess anywhere else", () => {
    for (const href of [
      'http://localhost:5173/',
      'http://ada.github.io/tessl-carnival/',
      'https://ada.github.io.evil.example/tessl-carnival/',
      'https://carnival.example.com/',
      'https://ada-carnival-5173.app.github.dev/',
    ]) {
      expect(forkRepo(href)).toBeUndefined();
    }
  });
});

describe('suggestGameLink', () => {
  it('opens the idea issue form on the fork, labelled for the factory', () => {
    const url = new URL(suggestGameLink('https://github.com/ada/tessl-carnival', '  Ring  toss\n'));
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/ada/tessl-carnival/issues/new');
    expect(url.searchParams.get('labels')).toBe('tessl');
    expect(url.searchParams.get('template')).toBe('01-your-own-idea.yml');
    expect(url.searchParams.get('title')).toBe('New game: Ring toss');
    expect(url.searchParams.get('what')).toContain('Ring toss');
  });

  it('still makes a useful issue with no idea, and caps a long one', () => {
    const empty = new URL(suggestGameLink('https://github.com/ada/x', '   '));
    expect(empty.searchParams.get('title')).toBe('New game: an idea for an empty booth');
    const long = new URL(suggestGameLink('https://github.com/ada/x', 'a'.repeat(5000)));
    expect(long.searchParams.get('title')!.length).toBeLessThanOrEqual(MAX_IDEA_LENGTH + 20);
  });

  it('keeps the idea inside its own field', () => {
    const url = new URL(suggestGameLink('https://github.com/ada/x', 'a&labels=wontfix#top'));
    expect(url.searchParams.getAll('labels')).toEqual(['tessl']);
    expect(url.hash).toBe('');
  });
});
