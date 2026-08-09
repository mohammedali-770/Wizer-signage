import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
const wrapperPath = resolve(root, 'scripts/deploy-production.sh');
const wrapper = readFileSync(wrapperPath, 'utf8');

describe('production deployment wrapper', () => {
  it('is syntactically valid bash', () => {
    expect(() => execFileSync('bash', ['-n', wrapperPath])).not.toThrow();
  });

  it('requires exactly one full immutable release SHA', () => {
    expect(wrapper).toContain('^[0-9a-f]{40}$');
    expect(wrapper).toContain('exactly one immutable release SHA is accepted');
    expect(wrapper).toContain('production-preflight.sh" "${TARGET_SHA}"');
  });

  it('fails before deploy if protected remote main moved', () => {
    const remoteCheck = wrapper.indexOf('ls-remote origin refs/heads/main');
    const compare = wrapper.indexOf('REMOTE_MAIN_SHA}" == "${TARGET_SHA}');
    const handoff = wrapper.indexOf('exec bash "${SCRIPT_DIR}/deploy-blue-green.sh"');

    expect(remoteCheck).toBeGreaterThan(0);
    expect(compare).toBeGreaterThan(remoteCheck);
    expect(handoff).toBeGreaterThan(compare);
    expect(wrapper).toContain('aborting before image pull/migration');
  });

  it('exports the accepted identity for blue-green logs/future enforcement', () => {
    expect(wrapper).toContain('export EXPECTED_RELEASE_SHA="${TARGET_SHA}"');
  });
});
