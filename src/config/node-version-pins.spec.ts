import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Node version is declared in four places: `.nvmrc` (what `nvm use` reads),
 * `engines` in package.json (what hosting providers honour), the Dockerfile
 * (what actually runs in production) and the README (what a human reads first).
 *
 * They already drifted once: `engines` and `.nvmrc` were bumped to 26 while the
 * Dockerfile kept building `node:22-alpine`, so the image ran a runtime the
 * project did not pin. The comment asking to keep them in sync was in the file
 * the whole time and changed nothing. These assertions are that comment, made
 * executable.
 */
const repoRoot = join(__dirname, '..', '..');
const readRepoFile = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

describe('Node version pins stay aligned', () => {
  it('pins the same major in .nvmrc, engines and the Dockerfile', () => {
    const dockerfile = readRepoFile('Dockerfile');
    const dockerPins = dockerfile.match(/^ARG NODE_VERSION=(\d+)$/m);

    expect(dockerPins).not.toBeNull();
    const dockerMajor = dockerPins![1];

    expect(readRepoFile('.nvmrc').trim()).toBe(dockerMajor);
    expect(JSON.parse(readRepoFile('package.json')).engines.node).toBe(`${dockerMajor}.x`);
  });

  it('builds every stage from that single pin, never a hardcoded image', () => {
    const dockerfile = readRepoFile('Dockerfile');

    // A literal `node:22-alpine` here is exactly how the stages fell behind.
    expect(dockerfile).not.toMatch(/^FROM node:\d+-/m);
    expect(dockerfile.match(/^FROM node:\$\{NODE_VERSION\}-alpine AS/gm)).toHaveLength(3);
  });

  it('does not depend on Corepack, which Node 26 no longer ships', () => {
    const dockerfile = readRepoFile('Dockerfile');
    const packageJson = JSON.parse(readRepoFile('package.json'));

    expect(dockerfile).not.toMatch(/^RUN corepack enable$/m);

    // pnpm is installed from npm instead, so its pin has to match packageManager.
    const pnpmMajorVersion = packageJson.packageManager.replace('pnpm@', '');
    const installed = dockerfile.match(/^RUN npm install -g pnpm@(\S+)$/gm) ?? [];

    expect(installed.length).toBeGreaterThan(0);
    for (const line of installed) {
      expect(line).toBe(`RUN npm install -g pnpm@${pnpmMajorVersion}`);
    }
  });
});
