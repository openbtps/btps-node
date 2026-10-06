import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * EBA-154: confirms @nestjs/testing has been a devDependency of
 * examples/btps-nest-app since 6b73e35, pinned to the same major version
 * as @nestjs/core, and guards that pin against drifting out of sync between
 * package.json and yarn.lock (criterion 1). Also guards yarn.lock's
 * @btps/sdk resolution hash against going stale again (criterion 2), the
 * failure c997031 fixed. These checks read the raw config files so they do
 * not depend on node_modules being installed.
 */
describe('examples/btps-nest-app dependency configuration (EBA-154)', () => {
  const appRoot = path.join(__dirname, '..');
  const packageJsonPath = path.join(appRoot, 'package.json');
  const yarnLockPath = path.join(appRoot, 'yarn.lock');

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  function majorVersion(range: string): string {
    const match = range.match(/(\d+)/);
    if (!match) {
      throw new Error(`Could not find a major version number in "${range}"`);
    }
    return match[1];
  }

  it('declares @nestjs/core as a runtime dependency', () => {
    expect(packageJson.dependencies).toHaveProperty('@nestjs/core');
  });

  it('declares @nestjs/testing as a devDependency', () => {
    expect(packageJson.devDependencies).toHaveProperty('@nestjs/testing');
  });

  it('pins @nestjs/testing to the same major version as @nestjs/core', () => {
    const coreRange: string = packageJson.dependencies['@nestjs/core'];
    const testingRange: string = packageJson.devDependencies['@nestjs/testing'];

    expect(majorVersion(testingRange)).toBe(majorVersion(coreRange));
  });

  describe('yarn.lock', () => {
    let lockFile: string;

    beforeAll(() => {
      expect(fs.existsSync(yarnLockPath)).toBe(true);
      lockFile = fs.readFileSync(yarnLockPath, 'utf-8');
    });

    function resolvedVersionFor(packageName: string, declaredRange: string): string {
      // Yarn Berry lockfile entries look like:
      //   "@nestjs/testing@npm:^10.0.0":
      //     version: 10.4.20
      //     resolution: "@nestjs/testing@npm:10.4.20"
      const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedRange = declaredRange.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyPattern = new RegExp(
        `"?${escapedName}@npm:${escapedRange}"?:\\n` + `(?:[^\\n]*\\n)*?` + `\\s+version: (\\S+)`,
      );

      const match = lockFile.match(keyPattern);
      if (!match) {
        throw new Error(
          `yarn.lock has no resolved entry for "${packageName}@npm:${declaredRange}". ` +
            'Run `yarn install` to update the lock file after editing package.json.',
        );
      }
      return match[1];
    }

    it('has a resolved entry for @nestjs/core matching the declared range', () => {
      const coreRange: string = packageJson.dependencies['@nestjs/core'];
      expect(() => resolvedVersionFor('@nestjs/core', coreRange)).not.toThrow();
    });

    it('has a resolved entry for @nestjs/testing matching the declared range', () => {
      const testingRange: string = packageJson.devDependencies['@nestjs/testing'];
      expect(() => resolvedVersionFor('@nestjs/testing', testingRange)).not.toThrow();
    });

    it('resolves @nestjs/testing to the same major version as @nestjs/core', () => {
      const coreRange: string = packageJson.dependencies['@nestjs/core'];
      const testingRange: string = packageJson.devDependencies['@nestjs/testing'];

      const resolvedCoreVersion = resolvedVersionFor('@nestjs/core', coreRange);
      const resolvedTestingVersion = resolvedVersionFor('@nestjs/testing', testingRange);

      expect(majorVersion(resolvedTestingVersion)).toBe(majorVersion(resolvedCoreVersion));
    });
  });

  describe('@btps/sdk local tarball lock entry (EBA-154)', () => {
    // yarn's file: protocol resolver stamps the resolution string with
    // `hash=<first 6 hex chars of sha512(tarball bytes)>`. If package.tgz is
    // rebuilt (or package.json's dependency changes) without re-running
    // `yarn install`, this value goes stale and `yarn install
    // --frozen-lockfile` fails. This test re-derives that hash from the
    // tarball on disk and compares it against what yarn.lock has recorded,
    // so a stale entry fails here with a clear cause instead of surfacing
    // only as an opaque frozen-install error.
    const tgzPath = path.join(appRoot, 'package.tgz');

    it('has a @btps/sdk file: dependency pointing at ./package.tgz', () => {
      expect(packageJson.dependencies).toHaveProperty('@btps/sdk', './package.tgz');
    });

    // package.tgz is hand-built per the app's README ("yarn add
    // ./package.tgz") and is gitignored (root .gitignore:24, `*.tgz`) — it
    // is never present on a fresh clone or in CI. The hash check below only
    // makes sense when it exists on disk to compare against; it is not this
    // ticket's job to make the dependency reproducible there (that is a
    // separate T2 follow-up the infra lead raised on this ticket). Skip
    // rather than fail when the tarball is absent, so this stays a local
    // regression guard and not a false CI failure.
    const describeWhenTgzPresent = fs.existsSync(tgzPath) ? describe : describe.skip;

    describeWhenTgzPresent('when package.tgz is present on disk', () => {
      it("yarn.lock's @btps/sdk resolution hash matches the sha512 of package.tgz", () => {
        const tgzBuffer = fs.readFileSync(tgzPath);
        const expectedHash = crypto.createHash('sha512').update(tgzBuffer).digest('hex').slice(0, 6);

        const lockFile = fs.readFileSync(yarnLockPath, 'utf-8');
        const resolutionMatch = lockFile.match(
          /"@btps\/sdk@file:\.\/package\.tgz::locator=[^"]*":\n(?:[^\n]*\n)*?\s+resolution: "@btps\/sdk@file:\.\/package\.tgz#\.\/package\.tgz::hash=([0-9a-f]+)&/,
        );

        if (!resolutionMatch) {
          throw new Error(
            'yarn.lock has no resolution entry for the @btps/sdk file: dependency. ' +
              'Run `yarn install` to add/refresh it after editing package.json or package.tgz.',
          );
        }

        expect(resolutionMatch[1]).toBe(expectedHash);
      });
    });
  });
});
