import './style.css';
import { applyTheme, bestScore, type CarnivalGame } from './carnival';
import { registry } from './games';
import { startMidway } from './midway/midway';
import { startMidway3d } from './midway/midway3d';
import type { BoothSlot } from './midway/world';
import {
  carnivalLink,
  forkRepo,
  MAX_IDEA_LENGTH,
  REPO_URL,
  shareLinks,
  suggestGameLink,
} from './share';

applyTheme();

const app = document.querySelector<HTMLElement>('#app')!;
let stop: (() => void) | undefined;

function bestText(game: CarnivalGame): string {
  const best = bestScore(game.id);
  return best === undefined ? 'No scores yet' : `Best: ${best}`;
}

function renderMidway() {
  document.body.dataset.view = 'midway';
  app.innerHTML = `
    <section class="midway">
      <canvas class="midway-map" aria-label="The carnival midway. Walk up to a booth to play its game."></canvas>
      <p class="midway-help"></p>
      <p class="midway-credit">
        Built with
        <a href="https://tessl.io/?utm_source=carnival&amp;utm_medium=midway-credit&amp;utm_campaign=tessl-carnival" target="_blank" rel="noopener">Tessl</a>
        at
        <a href="https://tessl.io/devcon?utm_source=carnival&amp;utm_medium=midway-credit&amp;utm_campaign=tessl-carnival" target="_blank" rel="noopener">AI DevCon NYC</a>
        <span class="midway-links">
          <a href="${REPO_URL}" target="_blank" rel="noopener">Build your own</a>
          <span class="midway-share" hidden>
            · Share on
            <a class="share-x" target="_blank" rel="noopener">X</a>
            or
            <a class="share-linkedin" target="_blank" rel="noopener">LinkedIn</a>
          </span>
        </span>
      </p>
      <nav class="midway-guide" aria-label="Booths">
        <h2>Booths</h2>
        <ul></ul>
      </nav>
      <div class="booth-card" aria-live="polite" hidden>
        <h2></h2>
        <p class="description"></p>
        <p class="best"></p>
        <a class="play">Play</a>
        <form class="suggest" hidden>
          <label for="suggest-idea">Got a game for this booth?</label>
          <div class="suggest-row">
            <input id="suggest-idea" name="idea" maxlength="${MAX_IDEA_LENGTH}" autocomplete="off" placeholder="A ring toss with moving bottles" />
            <button type="submit">Suggest it</button>
          </div>
          <p class="suggest-note">Opens an issue on GitHub for this carnival's factory to build.</p>
        </form>
      </div>
    </section>`;

  const link = carnivalLink(location.href);
  if (link) {
    const share = shareLinks(link);
    app.querySelector<HTMLAnchorElement>('.share-x')!.href = share.x;
    app.querySelector<HTMLAnchorElement>('.share-linkedin')!.href = share.linkedIn;
    app.querySelector<HTMLElement>('.midway-share')!.hidden = false;
  }

  const guide = app.querySelector('.midway-guide ul')!;
  for (const game of registry.all()) {
    const item = document.createElement('li');
    item.innerHTML = `<a href="#/play/${game.id}"><span class="name"></span> <span class="best"></span></a>`;
    item.querySelector('.name')!.textContent = game.name;
    item.querySelector('.best')!.textContent = bestText(game);
    guide.append(item);
  }

  const card = app.querySelector<HTMLElement>('.booth-card')!;
  const repo = forkRepo(location.href);
  const suggest = card.querySelector<HTMLFormElement>('.suggest')!;
  suggest.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!repo) return;
    const idea = new FormData(suggest).get('idea');
    window.open(suggestGameLink(repo, typeof idea === 'string' ? idea : ''), '_blank', 'noopener');
    suggest.reset();
  });
  const showBooth = (booth: BoothSlot | undefined) => {
    const game = booth?.gameId ? registry.get(booth.gameId) : undefined;
    card.hidden = booth === undefined;
    card.classList.toggle('closed', booth !== undefined && !game);
    card.querySelector('h2')!.textContent = game?.name ?? 'Coming soon';
    card.querySelector('.description')!.textContent =
      game?.description ?? 'This booth is waiting for a game. Build one and it opens here.';
    card.querySelector('.best')!.textContent = game ? bestText(game) : '';
    const link = card.querySelector<HTMLAnchorElement>('.play')!;
    link.hidden = !game;
    if (game) link.href = `#/play/${game.id}`;
    // Empty booths ask for a game, where we know which repository to ask.
    suggest.hidden = !(booth && !game && repo);
  };

  let canvas = app.querySelector('canvas')!;
  const options = {
    games: registry.all(),
    onPlay: (gameId: string) => (location.hash = `#/play/${gameId}`),
    onReach: showBooth,
  };
  // Walk the midway in 3D, or on the 2D map where the browser can't do WebGL.
  let midway3d: ReturnType<typeof startMidway3d>;
  try {
    midway3d = startMidway3d(canvas, options);
  } catch (error) {
    // A canvas that has a WebGL context can't draw 2D, so swap in a fresh one.
    console.error('The 3D midway failed to start; showing the 2D map instead.', error);
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  const help = app.querySelector('.midway-help')!;
  if (midway3d) {
    canvas.setAttribute(
      'aria-label',
      'The carnival midway in 3D. Walk up to a booth to play its game.',
    );
    help.innerHTML = `<kbd>WASD</kbd> to walk, <kbd>←</kbd> <kbd>→</kbd> or drag to look around,
      or click where you want to go. <kbd>E</kbd> to play.`;
  } else {
    help.innerHTML = `<kbd>WASD</kbd> or <kbd>arrows</kbd> to walk, or click where you want to go.
      <kbd>E</kbd> to play.`;
  }
  stop = (midway3d ?? startMidway(canvas, options)).stop;
}

function renderGame(game: CarnivalGame) {
  document.body.dataset.view = 'game';
  app.innerHTML = `
    <section class="game">
      <div class="game-header">
        <a href="#/">← Back to the midway</a>
        <h1></h1>
      </div>
      <canvas></canvas>
    </section>`;
  app.querySelector('h1')!.textContent = game.name;
  stop = game.start(app.querySelector('canvas')!);
}

function route() {
  stop?.();
  stop = undefined;

  const match = location.hash.match(/^#\/play\/([\w-]+)$/);
  const game = match ? registry.get(match[1]) : undefined;
  if (game) renderGame(game);
  else renderMidway();
}

window.addEventListener('hashchange', route);
route();
