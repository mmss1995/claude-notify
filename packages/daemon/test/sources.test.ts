import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LocalCliSource } from '../src/sources/localCli.js';
import { LocalFilesEnricher } from '../src/sources/localFiles.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const STUB = join(FIXTURES, 'fake-claude.sh');

const useFixture = (name: string): void => {
  process.env.CCN_TEST_FIXTURE = join(FIXTURES, name);
};

afterEach(() => {
  delete process.env.CCN_TEST_FIXTURE;
  delete process.env.CCN_TEST_FAIL;
});

describe('LocalCliSource', () => {
  it('parses the shape the 2.1.270 CLI actually emits', async () => {
    useFixture('agents-normal.json');
    const { sessions, warnings } = await new LocalCliSource({ redactPaths: true, command: STUB }).fetch();

    expect(warnings).toEqual([]);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toMatchObject({
      sessionId: '8fa8523f-7f21-488f-84c9-59bea52977fe',
      name: 'eurobet-gitlabcodeland-56',
      status: 'waiting',
      folder: 'Eurobet - GitlabCodeland',
    });
  });

  it('withholds the full path when redactPaths is on but keeps the folder label', async () => {
    useFixture('agents-normal.json');
    const { sessions } = await new LocalCliSource({ redactPaths: true, command: STUB }).fetch();

    // ntfy topics are public, and these cwds carry client names.
    expect(sessions[0]?.cwd).toBeNull();
    expect(sessions[0]?.folder).toBe('digital-project-evolution');
  });

  it('includes the full path when redaction is off', async () => {
    useFixture('agents-normal.json');
    const { sessions } = await new LocalCliSource({ redactPaths: false, command: STUB }).fetch();

    expect(sessions[0]?.cwd).toContain('/Volumes/ExternalSSD');
  });

  it('passes through a status value it has never seen', async () => {
    useFixture('agents-unknown-status.json');
    const { sessions, warnings } = await new LocalCliSource({ redactPaths: true, command: STUB }).fetch();

    // A future release inventing a status must not take the daemon down.
    expect(sessions[0]?.status).toBe('compacting');
    expect(warnings).toEqual([]);
  });

  it('skips an entry that no longer matches and keeps the rest', async () => {
    useFixture('agents-malformed-entry.json');
    const { sessions, warnings } = await new LocalCliSource({ redactPaths: true, command: STUB }).fetch();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('good');
    expect(warnings).toHaveLength(1);
  });

  it('throws when the CLI fails, so the poller can skip the tick', async () => {
    process.env.CCN_TEST_FAIL = '1';
    await expect(new LocalCliSource({ redactPaths: true, command: STUB }).fetch()).rejects.toThrow(/failed/);
  });
});

describe('LocalFilesEnricher', () => {
  it('supplies waitingFor, which the CLI does not expose', async () => {
    const { patches } = await new LocalFilesEnricher({ dir: join(FIXTURES, 'sessions') }).enrich();

    expect(patches.get('8fa8523f-7f21-488f-84c9-59bea52977fe')).toEqual({
      waitingFor: 'input needed',
      statusUpdatedAt: 1789402363666,
    });
  });

  it('ignores files it cannot parse rather than failing the poll', async () => {
    const { patches, warnings } = await new LocalFilesEnricher({ dir: join(FIXTURES, 'sessions') }).enrich();

    expect(patches.size).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('is silent when the directory does not exist', async () => {
    // This surface is internal; if a release moves or removes it the daemon
    // must carry on with localCli data alone.
    const { patches, warnings } = await new LocalFilesEnricher({ dir: '/nonexistent/claude/sessions' }).enrich();

    expect(patches.size).toBe(0);
    expect(warnings).toEqual([]);
  });
});
