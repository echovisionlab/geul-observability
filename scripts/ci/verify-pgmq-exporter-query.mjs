import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { parse } from 'yaml';

const databaseDsn = process.env.PGMQ_EXPORTER_TEST_DSN;
const readerRole =
  process.env.PGMQ_EXPORTER_READER_ROLE ?? 'geul_observability_reader';

if (!databaseDsn) {
  throw new Error(
    'PGMQ_EXPORTER_TEST_DSN must point to a disposable database at schema migration HEAD'
  );
}

const databaseUrl = new URL(databaseDsn);
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  throw new Error('PGMQ_EXPORTER_TEST_DSN must be a PostgreSQL URL');
}
if (
  !databaseUrl.hostname ||
  !databaseUrl.username ||
  databaseUrl.pathname.length <= 1
) {
  throw new Error(
    'PGMQ_EXPORTER_TEST_DSN must include host, user, and database'
  );
}

const postgresEnvironment = {
  PGDATABASE: decodeURIComponent(databaseUrl.pathname.slice(1)),
  PGHOST: databaseUrl.hostname,
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGPORT: databaseUrl.port || '5432',
  PGSSLMODE: databaseUrl.searchParams.get('sslmode') ?? 'prefer',
  PGUSER: decodeURIComponent(databaseUrl.username),
};

if (!/^[a-z_][a-z0-9_]*$/.test(readerRole)) {
  throw new Error(
    'PGMQ_EXPORTER_READER_ROLE must be a simple PostgreSQL role name'
  );
}

const queryConfig = parse(
  await readFile(
    new URL('../../infra/alloy/postgres-queries.yml', import.meta.url),
    'utf8'
  )
);
const exporterQuery = queryConfig.geul_pgmq_queue?.query;

assert.equal(typeof exporterQuery, 'string');
assert.ok(exporterQuery.length > 0);

const marker = randomUUID();
let messageId;

function runSql(sql) {
  const result = spawnSync(
    'psql',
    [
      '-X',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ...postgresEnvironment },
      input: sql,
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'psql integration command failed');
  }

  return result.stdout.trim();
}

async function waitForArchiveEstimate() {
  const deadline = Date.now() + 5_000;
  const readerQuery = `
SET ROLE ${readerRole};
SELECT archived_messages_estimate
FROM (
${exporterQuery}
) AS exporter_metrics
WHERE queue_name = 'email.auth';
`;

  while (Date.now() < deadline) {
    const output = runSql(readerQuery);
    const estimate = Number(output.split('\n').at(-1));
    if (Number.isFinite(estimate) && estimate > 0) {
      return estimate;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    'PGMQ exporter query did not expose the archived email.auth row'
  );
}

try {
  messageId = runSql(`
SELECT pgmq.send(
  'email.auth',
  jsonb_build_object('geul_observability_validation', '${marker}'),
  '{}'::jsonb,
  0
);
`)
    .split('\n')
    .at(-1);

  assert.match(messageId, /^\d+$/);

  const archived = runSql(`
SELECT pgmq.archive('email.auth', ${messageId}::bigint);
ANALYZE pgmq."a_email.auth";
SELECT count(*)
FROM pgmq."a_email.auth"
WHERE msg_id = ${messageId}::bigint
  AND message ->> 'geul_observability_validation' = '${marker}';
`)
    .split('\n')
    .at(-1);

  assert.equal(archived, '1');

  const estimate = await waitForArchiveEstimate();
  assert.ok(estimate > 0);
  process.stdout.write(
    `PGMQ exporter query exposed the nonzero archive estimate (${estimate}).\n`
  );
} finally {
  if (messageId && /^\d+$/.test(messageId)) {
    runSql(`
DELETE FROM pgmq."q_email.auth"
WHERE msg_id = ${messageId}::bigint
  AND message ->> 'geul_observability_validation' = '${marker}';
DELETE FROM pgmq."a_email.auth"
WHERE msg_id = ${messageId}::bigint
  AND message ->> 'geul_observability_validation' = '${marker}';
ANALYZE pgmq."a_email.auth";
`);
  }
}
