import * as fs from 'fs';
import * as path from 'path';

/**
 * EBA-154: @nestjs/testing must be a devDependency of examples/btps-nest-app,
 * pinned to the same major version as @nestjs/core, with yarn.lock updated
 * to match. These checks read the raw config files so they do not depend on
 * node_modules being installed.
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
});
