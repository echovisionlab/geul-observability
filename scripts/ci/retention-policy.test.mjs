import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const lokiConfigUrl = new URL('../../infra/loki/loki.yml', import.meta.url);
const mimirConfigUrl = new URL('../../infra/mimir/mimir.yml', import.meta.url);
const tempoConfigUrls = [
  new URL('../../infra/tempo/tempo.yml', import.meta.url),
  new URL('../../infra/tempo/tempo.prod.yml', import.meta.url),
];
const coreComposeUrl = new URL(
  '../../compose/observability-core.yml',
  import.meta.url
);
const agentComposeUrl = new URL(
  '../../compose/observability-agent.yml',
  import.meta.url
);

const retentionPolicy = {
  application: {
    variable: 'GEUL_LOKI_APPLICATION_RETENTION_PERIOD',
    defaultPeriod: '2160h',
  },
  diagnostic: {
    variable: 'GEUL_LOKI_DIAGNOSTIC_RETENTION_PERIOD',
    defaultPeriod: '720h',
  },
  system: {
    variable: 'GEUL_LOKI_SYSTEM_RETENTION_PERIOD',
    defaultPeriod: '2232h',
  },
};

test('Loki applies the deployment-owned retention period for every canonical class', async () => {
  const config = parse(await readFile(lokiConfigUrl, 'utf8'));
  const compose = parse(await readFile(coreComposeUrl, 'utf8'));
  const loki = compose.services['loki-prod'];

  assert.deepEqual(loki.command, [
    '-config.file=/etc/loki/local-config.yaml',
    '-config.expand-env=true',
  ]);
  assert.equal(
    config.limits_config.retention_period,
    '${GEUL_LOKI_APPLICATION_RETENTION_PERIOD}'
  );

  const actualRules = new Map(
    config.limits_config.retention_stream.map((rule) => [
      rule.selector.match(/^\{retention_class="([a-z]+)"\}$/)?.[1],
      rule,
    ])
  );
  assert.equal(actualRules.size, 3);

  for (const [retentionClass, policy] of Object.entries(retentionPolicy)) {
    assert.equal(
      loki.environment[policy.variable],
      `\${${policy.variable}:-${policy.defaultPeriod}}`
    );
    assert.match(policy.defaultPeriod, /^[1-9][0-9]*h$/);
    const rule = actualRules.get(retentionClass);
    assert.deepEqual(rule, {
      selector: `{retention_class="${retentionClass}"}`,
      priority: 1,
      period: `\${${policy.variable}}`,
    });
  }

  assert.equal(config.limits_config.max_query_length, '30d1h');
  assert.equal(config.limits_config.max_entries_limit_per_query, 5000);
  assert.equal(config.limits_config.split_queries_by_interval, '1h');
  assert.equal(config.compactor.retention_enabled, true);
});

test('Alloy persists Docker log positions across restarts', async () => {
  for (const composeUrl of [coreComposeUrl, agentComposeUrl]) {
    const compose = parse(await readFile(composeUrl, 'utf8'));
    const alloy =
      compose.services['alloy-prod'] ?? compose.services['alloy-agent'];
    const dataVolume = alloy.volumes.find((volume) =>
      String(volume).endsWith(':/var/lib/alloy/data')
    );

    assert.ok(
      dataVolume,
      `${composeUrl.pathname}: Alloy data volume is missing`
    );
    assert.match(
      alloy.command,
      /--storage\.path=\/var\/lib\/alloy\/data/,
      `${composeUrl.pathname}: Alloy storage path is not persistent`
    );
    assert.ok(
      Object.hasOwn(compose.volumes ?? {}, dataVolume.split(':')[0]),
      `${composeUrl.pathname}: Alloy data volume is undeclared`
    );
  }
});

test('Mimir and Tempo apply the approved bounded retention periods', async () => {
  const mimir = parse(await readFile(mimirConfigUrl, 'utf8'));
  assert.equal(mimir.limits.compactor_blocks_retention_period, '720h');

  for (const tempoConfigUrl of tempoConfigUrls) {
    const tempo = parse(await readFile(tempoConfigUrl, 'utf8'));
    assert.equal(tempo.compactor.compaction.block_retention, '336h');
  }
});
