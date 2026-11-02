/** The original carnival, where anyone can fork their own. */
export const REPO_URL = 'https://github.com/tesslio/tessl-carnival';

const SHARE_TEXT =
  'I built a software factory on a browser carnival at AI DevCon NYC with @tessl_io. Play my carnival:';

/**
 * The address to share for the carnival at `href`: the page itself, without
 * the game route or query. Returns undefined where a link would be no use to
 * anyone else, such as a local dev server or a Codespaces preview.
 */
export function carnivalLink(href: string): string | undefined {
  const url = new URL(href);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const preview = url.hostname.endsWith('.app.github.dev');
  if (url.protocol !== 'https:' || local || preview) return undefined;
  return `${url.origin}${url.pathname}`;
}

/** Prefilled posts that share a carnival's link on X and LinkedIn. */
export function shareLinks(link: string) {
  return {
    x: `https://x.com/intent/post?${new URLSearchParams({ text: SHARE_TEXT, url: link })}`,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: link })}`,
  };
}

/**
 * The GitHub repository a carnival on GitHub Pages was built from, worked out
 * from its address: ada.github.io/tessl-carnival is github.com/ada/tessl-carnival.
 * Returns undefined anywhere else, where there's no telling.
 */
export function forkRepo(href: string): string | undefined {
  const url = new URL(href);
  const owner = /^([a-z0-9][a-z0-9-]{0,38})\.github\.io$/i.exec(url.hostname)?.[1];
  if (url.protocol !== 'https:' || !owner) return undefined;
  const first = url.pathname.split('/').find(Boolean);
  const repo = first && /^[\w.-]+$/.test(first) ? first : `${owner}.github.io`;
  return `https://github.com/${owner}/${repo}`;
}

/** The longest game idea a suggestion carries. */
export const MAX_IDEA_LENGTH = 200;

/**
 * A new issue on `repo` asking the factory for a game, labelled `tessl` so an
 * agent picks it up. GitHub only applies the label for people who can triage
 * the repository; for anyone else the owner adds it.
 */
export function suggestGameLink(repo: string, idea: string): string {
  const text = idea.replace(/\s+/g, ' ').trim().slice(0, MAX_IDEA_LENGTH);
  const params = new URLSearchParams({
    template: '01-your-own-idea.yml',
    labels: 'tessl',
    title: `New game: ${text || 'an idea for an empty booth'}`,
    what: `A new game for an empty booth on the midway: ${text || '(describe the game here)'}`,
    where: 'A new folder under src/games/, following skills/add-carnival-game/SKILL.md',
  });
  return `${repo}/issues/new?${params}`;
}
