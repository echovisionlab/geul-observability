import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const dashboardsUrl = new URL(
  '../../infra/grafana/dashboards/',
  import.meta.url
);
const datasourceUrls = [
  new URL(
    '../../infra/grafana/provisioning/datasources/datasources.yml',
    import.meta.url
  ),
  new URL(
    '../../infra/grafana/provisioning/datasources/datasources.prod.yml',
    import.meta.url
  ),
  new URL(
    '../../infra/grafana/provisioning/datasources/datasources.kubernetes.yml',
    import.meta.url
  ),
];
const uiComposeUrl = new URL(
  '../../compose/observability-ui.yml',
  import.meta.url
);
const appAgentConfigUrl = new URL(
  '../../infra/alloy/config.agent.app.alloy',
  import.meta.url
);
const agentComposeUrl = new URL(
  '../../compose/observability-agent.yml',
  import.meta.url
);
const coreComposeUrl = new URL(
  '../../compose/observability-core.yml',
  import.meta.url
);
const prodAlloyUrl = new URL(
  '../../infra/alloy/config.prod.alloy',
  import.meta.url
);
const kubernetesAlloyUrl = new URL(
  '../../infra/alloy/config.kubernetes.alloy',
  import.meta.url
);
const postgresQueriesUrl = new URL(
  '../../infra/alloy/postgres-queries.yml',
  import.meta.url
);
const readmeUrl = new URL('../../README.md', import.meta.url);
const fileMediaAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/file-media.yml',
  import.meta.url
);
const auditAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/audit.yml',
  import.meta.url
);
const collaborationAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/collaboration.yml',
  import.meta.url
);
const telemetryAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/telemetry.yml',
  import.meta.url
);
const authorizationAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/authorization.yml',
  import.meta.url
);
const translationAlertUrl = new URL(
  '../../infra/grafana/provisioning/alerting/translation.yml',
  import.meta.url
);
const notificationPolicyUrl = new URL(
  '../../infra/grafana/provisioning/alerting/notification-policy.yml',
  import.meta.url
);
const tempoConfigUrls = [
  new URL('../../infra/tempo/tempo.yml', import.meta.url),
  new URL('../../infra/tempo/tempo.prod.yml', import.meta.url),
];
const pluginProvisioningUrl = new URL(
  '../../infra/grafana/provisioning/plugins/plugins.yml',
  import.meta.url
);

async function dashboards() {
  const names = (await readdir(dashboardsUrl)).filter((name) =>
    name.endsWith('.json')
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      value: JSON.parse(await readFile(new URL(name, dashboardsUrl), 'utf8')),
    }))
  );
}

test('Grafana provisions the documented operational dashboard set', async () => {
  const values = await dashboards();
  const uids = new Set(values.map(({ value }) => value.uid));

  assert.deepEqual([...uids].sort(), [
    'geul-audit-security',
    'geul-authorization-operations',
    'geul-ingress-security',
    'geul-mail-delivery',
    'geul-queue-operations',
    'geul-service-overview',
    'translation-operations',
  ]);

  for (const { name, value } of values) {
    assert.ok(
      value.description?.trim(),
      `${name}: missing dashboard description`
    );
    assert.ok(value.refresh, `${name}: automatic refresh is disabled`);

    for (const panel of value.panels ?? []) {
      assert.ok(
        panel.description?.trim(),
        `${name}: ${panel.title} is missing a purpose description`
      );
      assert.ok(panel.gridPos, `${name}: ${panel.title} has no grid position`);
      assert.ok(
        panel.gridPos.x >= 0 &&
          panel.gridPos.w > 0 &&
          panel.gridPos.x + panel.gridPos.w <= 24,
        `${name}: ${panel.title} is outside the 24-column grid`
      );
    }

    const panels = value.panels ?? [];
    assert.equal(
      new Set(panels.map((panel) => panel.id)).size,
      panels.length,
      `${name}: duplicate panel id`
    );
    for (let leftIndex = 0; leftIndex < panels.length; leftIndex += 1) {
      const left = panels[leftIndex];
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < panels.length;
        rightIndex += 1
      ) {
        const right = panels[rightIndex];
        const overlaps =
          left.gridPos.x < right.gridPos.x + right.gridPos.w &&
          left.gridPos.x + left.gridPos.w > right.gridPos.x &&
          left.gridPos.y < right.gridPos.y + right.gridPos.h &&
          left.gridPos.y + left.gridPos.h > right.gridPos.y;
        assert.equal(
          overlaps,
          false,
          `${name}: ${left.title} overlaps ${right.title}`
        );
      }
    }

    const hasLokiPanels = panels.some(
      (panel) => panel.datasource?.type === 'loki'
    );
    for (const variable of value.templating?.list ?? []) {
      assert.ok(
        variable.label?.trim(),
        `${name}: ${variable.name} exposes an internal variable name`
      );
    }
    const environment = (value.templating?.list ?? []).find(
      (variable) => variable.name === 'environment'
    );
    if (hasLokiPanels) {
      assert.match(
        String(environment?.query),
        /production,staging,development/,
        `${name}: environment inventory is incomplete`
      );
      assert.equal(
        environment?.label,
        'Log environment',
        `${name}: environment scope is misleading`
      );
    } else {
      assert.equal(
        environment,
        undefined,
        `${name}: exposes an environment filter unsupported by its metrics`
      );
    }

    for (const link of value.links ?? []) {
      const match = String(link.url).match(/^\/d\/([^/?]+)/);
      assert.ok(match, `${name}: unsupported external link ${link.url}`);
      assert.equal(
        link.includeVars,
        false,
        `${name}: navigation leaks incompatible variables into ${link.title}`
      );
      assert.ok(
        uids.has(match[1]),
        `${name}: link target ${match[1]} is missing`
      );
    }
    const linkedUids = new Set(
      (value.links ?? [])
        .map((link) => String(link.url).match(/^\/d\/([^/?]+)/)?.[1])
        .filter(Boolean)
    );
    const expectedLinks = [...uids].filter((uid) => uid !== value.uid).sort();
    assert.deepEqual(
      [...linkedUids].sort(),
      expectedLinks,
      `${name}: dashboard navigation is incomplete`
    );
  }
});

test('Grafana Compose mounts the complete provisioning and dashboard trees', async () => {
  const compose = parse(await readFile(uiComposeUrl, 'utf8'));
  const volumes = compose.services['grafana-prod'].volumes;

  assert.ok(
    volumes.includes(
      '../infra/grafana/provisioning/alerting:/etc/grafana/provisioning/alerting:ro'
    )
  );
  assert.ok(
    volumes.includes(
      '../infra/grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro'
    )
  );
  assert.ok(
    volumes.includes(
      '../infra/grafana/provisioning/datasources/datasources.prod.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro'
    )
  );
  assert.ok(
    volumes.includes(
      '../infra/grafana/provisioning/plugins:/etc/grafana/provisioning/plugins:ro'
    )
  );
  assert.ok(
    volumes.includes(
      '../infra/grafana/dashboards:/var/lib/grafana/dashboards:ro'
    )
  );
});

test('production Alloy collects PostgreSQL and allowlisted PGMQ metrics into Mimir', async () => {
  const alloy = await readFile(prodAlloyUrl, 'utf8');
  const compose = parse(await readFile(coreComposeUrl, 'utf8'));
  const service = compose.services['alloy-prod'];

  assert.match(alloy, /prometheus\.exporter\.postgres "geul"/);
  assert.match(alloy, /sys\.env\("GEUL_POSTGRES_OBSERVER_DSN"\)/);
  assert.match(
    alloy,
    /custom_queries_config_path = "\/etc\/alloy\/postgres-queries\.yml"/
  );
  assert.match(alloy, /prometheus\.scrape "postgres"/);
  assert.match(
    alloy,
    /targets\s+= prometheus\.exporter\.postgres\.geul\.targets/
  );
  assert.match(
    alloy,
    /forward_to\s+= \[prometheus\.remote_write\.mimir\.receiver\]/
  );
  assert.match(alloy, /url = "http:\/\/mimir-prod:9009\/api\/v1\/push"/);
  assert.doesNotMatch(alloy, /postgres(?:ql)?:\/\//);

  assert.equal(
    service.environment.GEUL_POSTGRES_OBSERVER_DSN,
    '${GEUL_POSTGRES_OBSERVER_DSN:?set GEUL_POSTGRES_OBSERVER_DSN}'
  );
  assert.ok(
    service.volumes.includes(
      '../infra/alloy/postgres-queries.yml:/etc/alloy/postgres-queries.yml:ro'
    )
  );
});

test('Kubernetes Alloy collects cluster Pod logs without privileged node mounts', async () => {
  const alloy = await readFile(kubernetesAlloyUrl, 'utf8');

  assert.match(alloy, /discovery\.kubernetes "pods"/);
  assert.match(alloy, /loki\.source\.kubernetes "pods"/);
  assert.match(alloy, /service_namespace/);
  assert.match(alloy, /retention_class/);
  assert.match(alloy, /exporter/);
  assert.match(alloy, /prometheus\.exporter\.postgres "geul"/);
  assert.match(alloy, /http:\/\/loki:3100\/loki\/api\/v1\/push/);
  assert.match(alloy, /endpoint = "tempo:4317"/);
  assert.match(alloy, /http:\/\/mimir:9009/);
  assert.doesNotMatch(alloy, /discovery\.docker|\/var\/run\/docker\.sock/);
  assert.doesNotMatch(alloy, /postgres(?:ql)?:\/\//);
});

test('Kubernetes datasources use runtime-provided authorities', async () => {
  const kubernetesDatasource = parse(
    await readFile(datasourceUrls.at(-1), 'utf8')
  );
  const byUid = new Map(
    kubernetesDatasource.datasources.map((datasource) => [
      datasource.uid,
      datasource,
    ])
  );

  assert.equal(byUid.get('mimir').url, '$GEUL_MIMIR_URL');
  assert.equal(byUid.get('loki').url, '$GEUL_LOKI_URL');
  assert.equal(byUid.get('tempo').url, '$GEUL_TEMPO_URL');
  assert.equal(byUid.get('durable-records').url, '$GEUL_POSTGRES_HOST');
});

test('Ingress Security keeps client identity in the log body and omits query strings', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-ingress-security'
  );
  const expressions = value.panels.flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr).filter(Boolean)
  );

  assert.equal(expressions.length, 5);
  for (const expression of expressions) {
    assert.match(expression, /service_name="haproxy-ingress"/);
    assert.match(expression, /\\\.env/);
    assert.doesNotMatch(expression, /query|string|%HQ/i);
  }
  assert.match(expressions.at(-1), /cf_ray/);
  assert.match(expressions.at(-1), /cf_connecting_ip/);
  assert.match(expressions.at(-1), /peer_ip/);
  assert.match(expressions.at(-1), /country/);
  assert.match(expressions.at(-1), /city/);
  assert.match(expressions.at(-1), /user_agent/);
});

test('Grafana and Alloy document the portable credential boundary', async () => {
  const readme = await readFile(readmeUrl, 'utf8');

  assert.match(
    readme,
    /environment variables or your\n+orchestrator's secret store/
  );
  assert.match(readme, /dedicated PostgreSQL reader/);
  assert.match(readme, /configured\s+queries are read-only/);
  assert.doesNotMatch(readme, /GEUL_GRAFANA_POSTGRES_PASSWORD=|postgres:\/\//);
});

test('PGMQ exporter query discovers the live queue inventory and exposes bounded metrics', async () => {
  const config = parse(await readFile(postgresQueriesUrl, 'utf8'));
  const query = config.geul_pgmq_queue?.query ?? '';
  const metrics = Object.assign({}, ...(config.geul_pgmq_queue?.metrics ?? []));

  assert.match(query, /FROM pgmq\.list_queues\(\)/);
  assert.doesNotMatch(query, /\bVALUES\b/);
  assert.match(query, /CROSS JOIN LATERAL pgmq\.metrics/);
  assert.match(query, /queue_visible_length AS visible_messages/);
  assert.match(query, /queue_length - metrics\.queue_visible_length/);
  assert.match(query, /oldest_msg_age_sec/);
  assert.match(query, /pg_stat_user_tables/);
  assert.match(query, /n_live_tup/);
  assert.match(
    query,
    /archive_stats\.relname = 'a_' \|\| queue_names\.queue_name/
  );
  assert.doesNotMatch(query, /replace\(queue_names\.queue_name/);
  assert.doesNotMatch(query, /FROM pgmq\.a_/);
  assert.doesNotMatch(query, /\bheaders\b/);

  assert.deepEqual(Object.keys(metrics), [
    'queue_name',
    'visible_messages',
    'in_flight_messages',
    'oldest_message_age_seconds',
    'archived_messages_estimate',
  ]);
  assert.equal(metrics.queue_name.usage, 'LABEL');
  for (const name of Object.keys(metrics).filter(
    (name) => name !== 'queue_name'
  )) {
    assert.equal(metrics[name].usage, 'GAUGE');
    assert.ok(metrics[name].description);
  }
});

test('Queue Operations displays PGMQ state and PostgreSQL load from Mimir', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-queue-operations'
  );
  const expectedExpressions = new Map([
    [
      'PGMQ Visible',
      'sum(geul_pgmq_queue_visible_messages{queue_name=~"${queue:raw}"}) or vector(0)',
    ],
    [
      'PGMQ In Flight',
      'sum(geul_pgmq_queue_in_flight_messages{queue_name=~"${queue:raw}"}) or vector(0)',
    ],
    [
      'PGMQ Oldest Message',
      'max(geul_pgmq_queue_oldest_message_age_seconds{queue_name=~"${queue:raw}"}) or vector(0)',
    ],
    [
      'PGMQ Archived (estimate)',
      'sum(geul_pgmq_queue_archived_messages_estimate{queue_name=~"${queue:raw}"}) or vector(0)',
    ],
    [
      'PostgreSQL Up',
      '(min(pg_up) * (1 - max(pg_exporter_last_scrape_error))) or vector(0)',
    ],
    [
      'PostgreSQL Connections',
      'sum(pg_stat_database_numbackends{datname="geul"}) or vector(0)',
    ],
    [
      'PostgreSQL Transactions/s',
      '(sum(rate(pg_stat_database_xact_commit{datname="geul"}[$__rate_interval])) + sum(rate(pg_stat_database_xact_rollback{datname="geul"}[$__rate_interval]))) or vector(0)',
    ],
    [
      'PostgreSQL Database Size',
      'sum(pg_database_size_bytes{datname="geul"}) or vector(0)',
    ],
  ]);

  for (const [title, expression] of expectedExpressions) {
    const panel = value.panels.find((candidate) => candidate.title === title);
    assert.ok(panel, `${title}: missing panel`);
    assert.equal(panel.datasource.uid, 'mimir');
    assert.equal(panel.targets[0].expr, expression);
    assert.equal(panel.targets[0].instant, true);
  }
});

test('Queue Operations extracts log level from the OTLP body before filtering', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-queue-operations'
  );
  const filteredTargets = value.panels.flatMap((panel) =>
    (panel.targets ?? [])
      .filter((target) => target.expr?.includes('| level=~'))
      .map((target) => ({ panel: panel.title, expression: target.expr }))
  );

  assert.equal(filteredTargets.length, 3);
  for (const { panel, expression } of filteredTargets) {
    assert.match(
      expression,
      /\| json [^|]*level="body\.level"/,
      `${panel}: level filter does not extract body.level`
    );
  }
});

test('production UI provisions the empty plugin directory without startup errors', async () => {
  const config = parse(await readFile(pluginProvisioningUrl, 'utf8'));
  assert.equal(config.apiVersion, 1);
  assert.deepEqual(config.apps, []);
});

test('stat colors distinguish volume, warning, and failure signals', async () => {
  const expected = new Map(
    Object.entries({
      'audit-security.json': {
        'Domain Audit': ['green'],
        'Personal Data Reads': ['blue'],
        'Authentication Failures': ['green', 'red'],
        'Authorization Denied': ['green', 'orange'],
      },
      'authorization-operations.json': {
        'Synchronous Authorization Boundary Failures': ['green', 'red'],
        'Prolonged SpiceDB-to-Database Commit Boundaries': ['green', 'red'],
      },
      'mail-delivery.json': {
        'Mail Sends': ['blue'],
        'Mail Attempts': ['blue'],
        'Recipient Statuses': ['blue'],
        'Send Failure Ratio': ['green', 'red'],
      },
      'ingress-security.json': {
        'Suspicious probes': ['green', 'orange'],
      },
      'queue-operations.json': {
        'Queue Events': ['green'],
        'Queue Failures': ['green', 'red'],
        'Retries Accepted': ['green', 'yellow'],
        'DLQ Events': ['green', 'red'],
        'PGMQ Visible': ['blue'],
        'PGMQ In Flight': ['blue'],
        'PGMQ Oldest Message': ['blue'],
        'PGMQ Archived (estimate)': ['blue'],
        'PostgreSQL Up': ['red', 'green'],
        'PostgreSQL Connections': ['blue'],
        'PostgreSQL Transactions/s': ['blue'],
        'PostgreSQL Database Size': ['blue'],
      },
      'service-overview.json': {
        'Request Rate Now': ['blue'],
        'Client Rejections in Range': ['green', 'yellow'],
        'Request Latency p95 Now': ['blue'],
        'Server Failures in Range': ['green', 'red'],
      },
      'translation-operations.json': {
        'Translation Commands Queued': ['blue'],
        'Applied Outcomes': ['green'],
        'Failed Outcomes': ['green', 'red'],
        'Apply Ratio': ['blue'],
      },
    }).map(([name, panels]) => [name, new Map(Object.entries(panels))])
  );

  for (const { name, value } of await dashboards()) {
    const expectedPanels = expected.get(name);
    assert.ok(expectedPanels, `${name}: missing stat color contract`);
    const statPanels = (value.panels ?? []).filter(
      (panel) => panel.type === 'stat'
    );
    assert.equal(statPanels.length, expectedPanels.size);
    for (const panel of statPanels) {
      assert.deepEqual(
        panel.fieldConfig?.defaults?.thresholds?.steps?.map(
          (step) => step.color
        ),
        expectedPanels.get(panel.title),
        `${name}: ${panel.title} has misleading default color semantics`
      );
    }
  }
});

test('textbox regex filters preserve the operator-provided pattern', async () => {
  for (const { name, value } of await dashboards()) {
    const textboxVariables = new Set(
      (value.templating?.list ?? [])
        .filter((variable) => variable.type === 'textbox')
        .map((variable) => variable.name)
    );

    for (const panel of value.panels ?? []) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr;
        if (typeof expression !== 'string') continue;

        assert.doesNotMatch(
          expression,
          /=~"[^"]*\\\./,
          `${name}: ${panel.title} uses an escaped regex in a LogQL quoted string`
        );

        for (const variable of textboxVariables) {
          const references = expression.matchAll(
            new RegExp(`\\$\\{${variable}(?::([^}]+))?\\}`, 'g')
          );
          for (const reference of references) {
            assert.equal(
              reference[1],
              'raw',
              `${name}: ${panel.title} escapes textbox regex ${variable}`
            );
            const rawRegex =
              panel.datasource?.type === 'loki'
                ? new RegExp(`=~\`\\$\\{${variable}:raw\\}\``)
                : new RegExp(`=~"\\$\\{${variable}:raw\\}"`);
            assert.match(
              expression,
              rawRegex,
              `${name}: ${panel.title} does not preserve raw regex ${variable}`
            );
          }
        }
      }
    }
  }
});

test('projection DLQ alert is provisioned', async () => {
  const config = parse(await readFile(fileMediaAlertUrl, 'utf8'));
  const rule = config.groups?.[0]?.rules?.[0];
  const query = rule?.data?.find((item) => item.refId === 'A');

  assert.equal(rule?.uid, 'geul-file-projection-dlq');
  assert.equal(rule?.for, '0s');
  assert.equal(rule?.noDataState, 'OK');
  assert.equal(rule?.execErrState, 'Alerting');
  assert.equal(query?.datasourceUid, 'loki');
  assert.match(query?.model?.expr ?? '', /queue\.dlq\.accepted/);
  assert.match(query?.model?.expr ?? '', /event="body\.event"/);
  assert.match(query?.model?.expr ?? '', /queue="body\.queue"/);
  assert.match(query?.model?.expr ?? '', /retention_class="application"/);
  assert.match(
    query?.model?.expr ?? '',
    /queue="editor_collab\.file_ingest\.projection"/
  );
  assert.match(rule?.annotations?.description ?? '', /7-day retention/);
  assert.equal(
    rule?.annotations?.runbook_url,
    '/d/geul-queue-operations/queue-operations'
  );
});

test('durable audit append failures alert on the exact canonical System record', async () => {
  const config = parse(await readFile(auditAlertUrl, 'utf8'));
  const rule = config.groups?.[0]?.rules?.[0];
  const query = rule?.data?.find((item) => item.refId === 'A');

  assert.equal(rule?.uid, 'geul-audit-append-failed');
  assert.equal(rule?.for, '0s');
  assert.equal(rule?.noDataState, 'OK');
  assert.equal(rule?.execErrState, 'Alerting');
  assert.equal(query?.datasourceUid, 'loki');
  assert.match(query?.model?.expr ?? '', /event="audit\.append\.failed"/);
  assert.match(query?.model?.expr ?? '', /event="body\.event"/);
  assert.match(query?.model?.expr ?? '', /retention_class="application"/);
  assert.equal(
    rule?.annotations?.runbook_url,
    '/d/geul-service-overview/service-overview'
  );
});

test('terminal collaboration checkpoint failures alert on the exact canonical System record', async () => {
  const config = parse(await readFile(collaborationAlertUrl, 'utf8'));
  const rule = config.groups?.[0]?.rules?.[0];
  const query = rule?.data?.find((item) => item.refId === 'A');

  assert.equal(rule?.uid, 'geul-collaboration-checkpoint-failed');
  assert.equal(rule?.for, '0s');
  assert.equal(rule?.noDataState, 'OK');
  assert.equal(rule?.execErrState, 'Alerting');
  assert.equal(
    rule?.annotations?.summary,
    'A collaboration edit-session checkpoint ended in terminal failure'
  );
  assert.equal(query?.datasourceUid, 'loki');
  assert.match(
    query?.model?.expr ?? '',
    /event="collaboration\.checkpoint\.failed"/
  );
  assert.match(query?.model?.expr ?? '', /event="body\.event"/);
  assert.match(query?.model?.expr ?? '', /domain="collaboration"/);
  assert.match(query?.model?.expr ?? '', /retention_class="application"/);
  assert.equal(
    rule?.annotations?.runbook_url,
    '/d/geul-service-overview/service-overview'
  );
});

test('telemetry pipeline degradation alert is provisioned', async () => {
  const config = parse(await readFile(telemetryAlertUrl, 'utf8'));
  const rule = config.groups?.[0]?.rules?.[0];
  const query = rule?.data?.find((item) => item.refId === 'A');

  assert.equal(rule?.uid, 'geul-telemetry-pipeline-degraded');
  assert.equal(rule?.for, '0s');
  assert.equal(rule?.noDataState, 'OK');
  assert.equal(rule?.execErrState, 'Alerting');
  assert.equal(query?.datasourceUid, 'loki');
  assert.match(query?.model?.expr ?? '', /event="body\.event"/);
  assert.match(
    query?.model?.expr ?? '',
    /event="telemetry\.pipeline\.degraded"/
  );
  assert.equal(
    rule?.annotations?.runbook_url,
    '/d/geul-service-overview/service-overview'
  );
});

test('synchronous authorization boundary alerts use implemented metrics', async () => {
  const config = parse(await readFile(authorizationAlertUrl, 'utf8'));
  const rules = config.groups?.[0]?.rules ?? [];
  assert.deepEqual(
    rules.map((rule) => rule.uid),
    [
      'geul-authorization-commit-uncertain',
      'geul-authorization-rollback-compensation-failed',
      'geul-authorization-write-outcome-uncertain',
      'geul-authorization-spicedb-to-database-commit-prolonged',
    ]
  );
  const expectedQueries = [
    /authorization_boundary_failure_total\{failure="commit_uncertain"\}/,
    /authorization_boundary_failure_total\{failure="rollback_compensation_failed"\}/,
    /authorization_spicedb_write_total\{outcome="uncertain"\}/,
    /authorization_spicedb_to_database_commit_duration_seconds_count/,
  ];
  for (const [index, rule] of rules.entries()) {
    const query = rule.data?.find((item) => item.refId === 'A');
    assert.equal(rule.for, '0s');
    assert.equal(rule.noDataState, 'OK');
    assert.equal(rule.execErrState, 'Alerting');
    assert.equal(query?.datasourceUid, 'mimir');
    assert.equal(query?.model?.queryType, 'instant');
    assert.match(query?.model?.expr ?? '', expectedQueries[index]);
    assert.match(query?.model?.expr ?? '', /\[5m\]/);
    assert.equal(query?.relativeTimeRange?.from, 300);
    assert.equal(
      rule.data?.find((item) => item.refId === 'B')?.model?.conditions?.[0]
        ?.evaluator?.params?.[0],
      0
    );
    assert.equal(rule.labels?.domain, 'authorization');
    assert.equal(rule.labels?.severity, 'critical');
    assert.equal(rule.labels?.notification_stage, 'disabled');
    assert.equal(
      rule.annotations?.runbook_url,
      '/d/geul-authorization-operations/authorization-operations'
    );
  }
  const prolongedExpression = rules[3].data?.find((item) => item.refId === 'A')
    ?.model?.expr;
  assert.match(
    prolongedExpression ?? '',
    /authorization_spicedb_to_database_commit_duration_seconds_bucket\{le="5"\}/
  );
  assert.match(prolongedExpression ?? '', /count\[5m\].*-.*bucket/);
});

test('Translation and OG terminal alerts use bounded authoritative failures', async () => {
  const config = parse(await readFile(translationAlertUrl, 'utf8'));
  const rules = config.groups?.[0]?.rules ?? [];

  assert.deepEqual(
    rules.map((rule) => rule.uid),
    [
      'geul-translation-job-failed',
      'geul-translation-og-handoff-failed',
      'geul-og-generation-failed',
    ]
  );

  const translationQuery = rules[0]?.data?.find((item) => item.refId === 'A');
  assert.equal(translationQuery?.datasourceUid, 'loki');
  assert.match(translationQuery?.model?.expr ?? '', /count_over_time\(/);
  assert.match(
    translationQuery?.model?.expr ?? '',
    /event="translation\.job\.failed"/
  );
  assert.match(
    translationQuery?.model?.expr ?? '',
    /sum by \(entity_type, target_locale, reason\)/
  );
  assert.match(
    translationQuery?.model?.expr ?? '',
    /entity_type="body\.entity_type"/
  );
  assert.match(
    translationQuery?.model?.expr ?? '',
    /target_locale="body\.target_locale"/
  );
  assert.match(translationQuery?.model?.expr ?? '', /reason="body\.reason"/);
  assert.doesNotMatch(translationQuery?.model?.expr ?? '', /og_handoff_failed/);
  assert.doesNotMatch(
    translationQuery?.model?.expr ?? '',
    /translation_job_status_total|translation_job|rawSql|increase\(/
  );

  const handoffQuery = rules[1]?.data?.find((item) => item.refId === 'A');
  assert.equal(handoffQuery?.datasourceUid, 'mimir');
  assert.match(
    handoffQuery?.model?.expr ?? '',
    /translation_og_handoff_total\{outcome="failed"\}/
  );
  assert.doesNotMatch(
    handoffQuery?.model?.expr ?? '',
    /entity_id|job_id|generation_id|request_id|queue\.(?:delivery\.requeued|retry\.accepted)/
  );

  const ogQuery = rules[2]?.data?.find((item) => item.refId === 'A');
  assert.equal(ogQuery?.datasourceUid, 'loki');
  assert.match(ogQuery?.model?.expr ?? '', /service_name="geul-og"/);
  assert.match(ogQuery?.model?.expr ?? '', /event="body\.event"/);
  assert.match(ogQuery?.model?.expr ?? '', /job_kind="body\.job_kind"/);
  assert.match(ogQuery?.model?.expr ?? '', /reason="body\.reason"/);
  assert.match(ogQuery?.model?.expr ?? '', /event="job\.failed"/);
  assert.match(ogQuery?.model?.expr ?? '', /job_kind="og_generation"/);
  assert.match(
    ogQuery?.model?.expr ?? '',
    /invalid_claim\|source_rejected\|processing_failed\|integrity_failed\|completion_rejected/
  );
  assert.doesNotMatch(
    ogQuery?.model?.expr ?? '',
    /queue\.(?:delivery\.requeued|retry\.accepted)/
  );

  for (const rule of rules) {
    assert.equal(rule.for, '0s');
    assert.equal(rule.noDataState, 'OK');
    assert.equal(rule.execErrState, 'Alerting');
    assert.equal(rule.labels?.notification_stage, 'disabled');
    assert.equal(
      rule.annotations?.runbook_url,
      '/d/translation-operations/translation-operations'
    );
  }
});

test('Translation dashboard exposes only the source-only explicit operation contract', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'translation-operations'
  );
  const source = JSON.stringify(value);
  const expressions = (value.panels ?? []).flatMap((panel) =>
    (panel.targets ?? [])
      .map((target) => target.expr)
      .filter((expression) => typeof expression === 'string')
  );
  const joinedExpressions = expressions.join('\n');

  for (const metric of [
    'translation_jobs_queued_total',
    'translation_job_status_total',
    'translation_job_duration_seconds_bucket',
    'translation_admin_action_total',
    'translation_og_handoff_total',
    'traces_spanmetrics_calls_total',
  ]) {
    assert.match(source, new RegExp(metric));
  }

  const variables = new Map(
    (value.templating?.list ?? []).map((variable) => [variable.name, variable])
  );
  const staleBacklog = (value.panels ?? []).find(
    (panel) => panel.title === 'Stale Backlog / Missing State'
  );
  const staleBacklogQuery = staleBacklog?.targets?.[0]?.rawSql ?? '';
  const versionRestoreLink = (value.links ?? []).find(
    (link) => link.title === 'Version Restore Audit'
  );
  assert.equal(variables.has('trigger_kind'), false);
  assert.equal(
    variables.get('entity_type')?.datasource?.uid,
    'durable-records'
  );
  assert.equal(
    variables.get('entity_type')?.query,
    'SELECT DISTINCT entity_type AS __text, entity_type AS __value FROM translation_source_state ORDER BY entity_type'
  );
  assert.equal(variables.get('entity_type')?.allValue, undefined);
  assert.equal(
    variables.get('target_locale')?.datasource?.uid,
    'durable-records'
  );
  assert.equal(
    variables.get('target_locale')?.query,
    'SELECT code AS __text, code AS __value FROM translation_locale ORDER BY sort_order, code'
  );
  assert.equal(variables.get('target_locale')?.allValue, undefined);
  assert.equal(
    variables.get('failure_reason')?.query,
    'provider_configuration,provider_authentication,provider_rate_limited,provider_unavailable,provider_rejected,provider_response_invalid,source_no_longer_current,target_apply_failed,og_handoff_failed,internal'
  );
  assert.equal(
    variables.get('admin_action')?.query,
    'regenerate_locale,regenerate_all,retry,cancel'
  );

  const terminalPanels = (value.panels ?? []).filter((panel) =>
    [5, 10, 11, 12].includes(panel.id)
  );
  assert.equal(terminalPanels.length, 4);
  for (const panel of terminalPanels) {
    assert.equal(panel.datasource?.uid, 'loki');
    const expression = panel.targets?.[0]?.expr ?? '';
    assert.match(expression, /count_over_time\(/);
    assert.match(
      expression,
      /deployment_environment=~"\$\{environment:regex\}"/
    );
    assert.match(expression, /domain="translation"/);
    assert.match(expression, /event="body\.event"/);
    assert.match(expression, /job_id="body\.job_id"/);
    assert.match(expression, /entity_type="body\.entity_type"/);
    assert.match(expression, /target_locale="body\.target_locale"/);
    assert.match(expression, /duration_ms="body\.duration_ms"/);
    assert.match(expression, /reason="body\.reason"/);
    assert.doesNotMatch(
      expression,
      /translation_job|rawSql|increase\(|offset \$__range/
    );
  }
  const failedJobsExpression =
    (value.panels ?? []).find((panel) => panel.id === 5)?.targets?.[0]?.expr ??
    '';
  assert.match(failedJobsExpression, /event="translation\.job\.failed"/);
  assert.match(failedJobsExpression, /entity_type=~`\$\{entity_type:regex\}`/);
  assert.match(
    failedJobsExpression,
    /target_locale=~`\$\{target_locale:regex\}`/
  );
  assert.match(failedJobsExpression, /reason=~`\$\{failure_reason:regex\}`/);
  const appliedOutcomesPanel = (value.panels ?? []).find(
    (panel) => panel.id === 10
  );
  const rangeApplyRatioPanel = (value.panels ?? []).find(
    (panel) => panel.id === 12
  );
  const rateApplyRatioPanel = (value.panels ?? []).find(
    (panel) => panel.id === 7
  );
  assert.equal(appliedOutcomesPanel?.title, 'Applied Outcomes');
  assert.equal(appliedOutcomesPanel?.targets?.[0]?.legendFormat, 'applied');
  assert.match(
    appliedOutcomesPanel?.targets?.[0]?.expr ?? '',
    /event="translation\.job\.applied"/
  );
  for (const panel of [rangeApplyRatioPanel, rateApplyRatioPanel]) {
    const expression = panel?.targets?.[0]?.expr ?? '';
    assert.match(expression, /event="translation\.job\.applied"/);
    assert.match(
      expression,
      /event=~`translation\[\.\]job\[\.\]\(applied\|failed\)`/
    );
    assert.doesNotMatch(expression, /published/);
  }
  assert.doesNotMatch(joinedExpressions, /translation\.job\.published/);
  assert.match(joinedExpressions, /translation_admin_action_total/);
  const queuedPanel = (value.panels ?? []).find((panel) => panel.id === 9);
  const queuedExpression = queuedPanel?.targets?.[0]?.expr ?? '';
  assert.match(queuedExpression, /increase\(translation_jobs_queued_total/);
  assert.doesNotMatch(queuedExpression, /unless translation_jobs_queued_total/);
  assert.doesNotMatch(queuedExpression, /offset \$__range/);
  const statusPanel = (value.panels ?? []).find((panel) => panel.id === 4);
  assert.equal(statusPanel?.datasource?.uid, 'mimir');
  assert.match(
    statusPanel?.targets?.[0]?.expr ?? '',
    /translation_job_status_total/
  );
  assert.doesNotMatch(
    statusPanel?.targets?.[0]?.expr ?? '',
    /count_over_time|translation\.job\./
  );
  assert.match(
    joinedExpressions,
    /translation_og_handoff_total\{entity_type=~.*target_locale=~/
  );
  assert.match(source, /ten-value failure catalog/);
  assert.match(source, /Translation to OG Handoff/);
  assert.doesNotMatch(source, /trigger_kind/);
  assert.match(
    joinedExpressions,
    /translation\[\.\]provider\[\.\]\(upload\|poll\|download\)/
  );
  assert.match(joinedExpressions, /span_kind="SPAN_KIND_CLIENT"/);
  assert.equal(staleBacklog?.datasource?.uid, 'durable-records');
  assert.match(staleBacklogQuery, /status = 'stale'/);
  assert.match(staleBacklogQuery, /translation_source_state/);
  assert.match(staleBacklogQuery, /translation_locale/);
  assert.match(staleBacklogQuery, /Missing entries \(informational\)/);
  assert.match(staleBacklog?.description ?? '', /Missing can be intentional/);
  assert.doesNotMatch(
    staleBacklogQuery,
    /locale\.(?:enabled|is_public)|expected_entries|required_coverage/i
  );
  assert.match(staleBacklogQuery, /entity_type:sqlstring/);
  assert.match(staleBacklogQuery, /target_locale:sqlstring/);
  assert.doesNotMatch(staleBacklogQuery, /:regex/);
  for (const table of [
    'post_translation',
    'page_translation',
    'work_translation',
    'program_event_translation',
    'release_translation',
    'artist_translation',
    'label_translation',
    'menu_translation',
    'email_template_translation',
    'email_layout_translation',
    'campaign_translation',
    'form_translation',
    'privacy_translation',
    'terms_translation',
    'series_translation',
  ]) {
    assert.match(staleBacklogQuery, new RegExp(`\\b${table}\\b`));
  }
  assert.equal(
    versionRestoreLink?.url,
    '/d/geul-audit-security/audit-security?var-changed_field=version_restore'
  );
  assert.match(source, /existing Translation job ID was requeued/);
  assert.match(joinedExpressions, /event=~`job\\\.\(succeeded\|failed\)`/);
  assert.match(joinedExpressions, /job_kind="og_generation"/);
  assert.doesNotMatch(
    source,
    /auto_source_update|translation_planner_(?:schedule|fanout)_total|translation_source_locale_switch_total|changed_no_fanout|debounce/i
  );
  assert.doesNotMatch(
    joinedExpressions,
    /manual_retry|last_error|translation_memory|checkpoint|target_editor|provider_document|xliff|request_body|response_body|raw_error|fallback|deferred|retry_later|completion_pending/i
  );
  assert.doesNotMatch(
    joinedExpressions,
    /queue\.(?:delivery\.requeued|retry\.accepted)/
  );
});

test('authorization dashboard uses only implemented bounded metrics', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-authorization-operations'
  );
  const source = JSON.stringify(value);
  const expressions = (value.panels ?? []).flatMap((panel) =>
    (panel.targets ?? [])
      .map((target) => target.expr)
      .filter((expression) => typeof expression === 'string')
  );

  for (const metric of [
    'authorization_spicedb_write_total',
    'authorization_spicedb_write_duration_seconds_bucket',
    'authorization_spicedb_check_total',
    'authorization_spicedb_check_duration_seconds_bucket',
    'authorization_boundary_failure_total',
    'authorization_spicedb_to_database_commit_duration_seconds_bucket',
  ]) {
    assert.match(source, new RegExp(metric));
  }
  assert.doesNotMatch(
    expressions.join('\n'),
    /zedtoken|token|resource_id|subject_id|tuple/i
  );
  assert.match(source, /le=\\"5\\"/);
});

test('unowned alert notifications are muted without disabling evaluation', async () => {
  const alertUrls = [
    fileMediaAlertUrl,
    auditAlertUrl,
    collaborationAlertUrl,
    telemetryAlertUrl,
    authorizationAlertUrl,
    translationAlertUrl,
  ];
  for (const alertUrl of alertUrls) {
    const config = parse(await readFile(alertUrl, 'utf8'));
    for (const group of config.groups ?? []) {
      assert.ok(group.interval, 'alert evaluation interval is missing');
      for (const rule of group.rules ?? []) {
        assert.equal(rule.labels?.notification_stage, 'disabled');
        assert.equal(
          rule.notification_settings,
          undefined,
          `${rule.uid}: direct contact point bypasses the muted policy route`
        );
      }
    }
  }

  const config = parse(await readFile(notificationPolicyUrl, 'utf8'));
  const mute = config.muteTimes?.find(
    (entry) => entry.name === 'geul-alert-notifications-disabled'
  );
  assert.deepEqual(mute?.time_intervals, [
    {
      times: [{ start_time: '00:00', end_time: '24:00' }],
      location: 'UTC',
    },
  ]);

  const root = config.policies?.[0];
  assert.equal(root?.receiver, 'grafana-default-email');
  assert.equal(root?.mute_time_intervals, undefined);
  assert.deepEqual(root?.routes, [
    {
      receiver: 'grafana-default-email',
      object_matchers: [['notification_stage', '=', 'disabled']],
      mute_time_intervals: ['geul-alert-notifications-disabled'],
    },
  ]);
});

test('Grafana log panels use only the canonical Loki contract', async () => {
  for (const { name, value } of await dashboards()) {
    const variables = new Set(
      (value.templating?.list ?? []).map((variable) => variable.name)
    );
    for (const panel of value.panels ?? []) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr;
        if (typeof expression !== 'string') continue;

        for (const [, variable] of expression.matchAll(
          /\$\{([a-zA-Z][a-zA-Z0-9_]*)(?::[^}]*)?\}/g
        )) {
          assert.ok(
            variables.has(variable),
            `${name}: ${panel.title} references missing variable ${variable}`
          );
        }

        if (expression.includes('exporter="otlp"')) {
          assert.match(
            expression,
            /service_namespace="geul"/,
            `${name}: ${panel.title}`
          );
          assert.match(
            expression,
            /retention_class=/,
            `${name}: ${panel.title}`
          );
        }
      }
    }
  }
});

test('Grafana extracts canonical fields from the OTLP body envelope', async () => {
  const bodyFields = [
    'actor_member_id',
    'assignment_id',
    'command_id',
    'correlation_id',
    'delivery_recipient_id',
    'duration_ms',
    'error_code',
    'error_type',
    'event',
    'job_kind',
    'message_id',
    'provider_message_id',
    'queue',
    'reason',
    'request_id',
    'run_id',
    'task_kind',
    'template_type',
    'trace_id',
  ];

  for (const { name, value } of await dashboards()) {
    for (const panel of value.panels ?? []) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr;
        if (
          typeof expression !== 'string' ||
          !expression.includes('exporter="otlp"')
        ) {
          continue;
        }

        assert.doesNotMatch(
          expression,
          /\| json(?:\s*\|)/,
          `${name}: ${panel.title} uses a bare JSON parser on an OTLP envelope`
        );
        for (const field of bodyFields) {
          const usesField = new RegExp(
            `(?:\\bby \\([^)]*\\b${field}\\b|\\| ${field}\\s*=|\\$\\{${field}:)`
          ).test(expression);
          if (!usesField) continue;
          assert.match(
            expression,
            new RegExp(`${field}="body\\.${field}"`),
            `${name}: ${panel.title} does not extract body.${field}`
          );
        }
      }
    }
  }
});

test('service overview uses the canonical terminal Request contract', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-service-overview'
  );
  const requestAccess = value.panels.find(
    (panel) => panel.title === 'Request Access Logs'
  );
  const variables = new Set(
    (value.templating?.list ?? []).map((variable) => variable.name)
  );

  assert.ok(requestAccess, 'Request Access panel is missing');
  assert.match(requestAccess.targets[0].expr, /domain="request"/);
  assert.match(requestAccess.targets[0].expr, /event="request\.completed"/);
  assert.match(requestAccess.targets[0].expr, /actor_member_id/);
  assert.match(requestAccess.targets[0].expr, /request_id/);
  assert.ok(variables.has('actor_member_id'));
  assert.ok(variables.has('request_id'));
  const clientRejections = value.panels.filter((panel) =>
    panel.title.includes('Client Rejection')
  );
  const serverFailures = value.panels.filter((panel) =>
    panel.title.includes('Server Failure')
  );
  assert.equal(clientRejections.length, 2);
  assert.equal(serverFailures.length, 2);
  for (const panel of clientRejections) {
    assert.equal(panel.datasource.uid, 'loki');
    assert.match(panel.targets[0].expr, /status_code="body\.status_code"/);
    assert.match(panel.targets[0].expr, /status_code=~`4\.\.`/);
  }
  for (const panel of serverFailures) {
    assert.equal(panel.datasource.uid, 'loki');
    assert.match(panel.targets[0].expr, /status_code="body\.status_code"/);
    assert.match(panel.targets[0].expr, /status_code=~`5\.\.`/);
  }
  assert.equal(
    value.panels.some((panel) => panel.datasource?.uid === 'tempo'),
    false
  );
});

test('Tempo generates bounded span metrics without the lossy service graph processor', async () => {
  for (const tempoConfigUrl of tempoConfigUrls) {
    const config = parse(await readFile(tempoConfigUrl, 'utf8'));
    assert.deepEqual(config.overrides.defaults.metrics_generator.processors, [
      'span-metrics',
    ]);
    assert.equal(config.metrics_generator.processor.service_graphs, undefined);
    assert.ok(config.metrics_generator.processor.span_metrics);
  }

  for (const datasourceUrl of datasourceUrls) {
    const config = parse(await readFile(datasourceUrl, 'utf8'));
    const tempo = config.datasources.find(
      (datasource) => datasource.uid === 'tempo'
    );
    assert.equal(tempo.jsonData.serviceMap, undefined);
    assert.equal(tempo.jsonData.tracesToMetrics.datasourceUid, 'mimir');
  }
});

test('Grafana datasources correlate logs with canonical trace_id', async () => {
  for (const datasourceUrl of datasourceUrls) {
    const source = await readFile(datasourceUrl, 'utf8');
    const config = parse(source);
    const loki = config.datasources.find(
      (datasource) => datasource.uid === 'loki'
    );
    const tempo = config.datasources.find(
      (datasource) => datasource.uid === 'tempo'
    );

    assert.match(loki.jsonData.derivedFields[0].matcherRegex, /trace_id/);
    assert.doesNotMatch(source, /traceID|attributes_trace_id/);
    assert.match(
      tempo.jsonData.tracesToLogsV2.query,
      /service_namespace="geul"/
    );
    assert.match(tempo.jsonData.tracesToLogsV2.query, /exporter="otlp"/);
    assert.match(
      tempo.jsonData.tracesToLogsV2.query,
      /retention_class=~"application\|diagnostic"/
    );
    assert.match(
      tempo.jsonData.tracesToLogsV2.query,
      /json trace_id="body\.trace_id"/
    );
    assert.match(tempo.jsonData.tracesToLogsV2.query, /trace_id/);
  }
});

test('Audit and Security use only the allowlisted PostgreSQL read boundary', async () => {
  const { value } = (await dashboards()).find(
    ({ value }) => value.uid === 'geul-audit-security'
  );
  const table = value.panels.find(
    (panel) => panel.title === 'Investigation Results'
  );
  const sql = table?.targets?.[0]?.rawSql ?? '';
  const variables = new Set(
    (value.templating?.list ?? []).map((variable) => variable.name)
  );

  assert.ok(table, 'human investigation table is missing');
  assert.equal(table.datasource.uid, 'durable-records');
  assert.match(sql, /FROM observability\.durable_record/);
  assert.doesNotMatch(sql, /public\.(?:domain_audit|security_access|member)/);
  assert.match(sql, /ORDER BY occurred_at DESC, record_id DESC/);
  assert.match(sql, /LIMIT 500/);
  assert.match(sql, /Viewed personal data/);
  assert.match(sql, /COALESCE\(target_type, subject_type\)/);
  assert.match(sql, /actor_service = \$\{email:sqlstring\}/);
  assert.equal(table.options.showColumnFilters, true);

  const activity = (value.templating?.list ?? []).find(
    (variable) => variable.name === 'action'
  );
  assert.equal(activity?.includeAll, false);
  assert.equal(activity?.allValue, undefined);
  assert.equal(activity?.current?.value, '__all__');
  assert.match(activity?.query ?? '', /^All activity : __all__,/);
  assert.match(
    sql,
    /\$\{action:sqlstring\} = '__all__' OR action = \$\{action:sqlstring\}/
  );

  const visibleVariables = (value.templating?.list ?? [])
    .filter((variable) => variable.hide !== 2)
    .map((variable) => variable.name);
  assert.deepEqual(visibleVariables, [
    'record_class',
    'action',
    'email',
    'target_type',
    'target_id',
    'reason',
    'source_ip',
    'request_id',
    'trace_id',
    'changed_field',
  ]);

  for (const variable of [
    'record_class',
    'action',
    'changed_field',
    'collection_operation',
    'previous_state',
    'new_state',
    'email',
    'actor_member_id',
    'contributor_member_id',
    'target_type',
    'target_id',
    'subject_type',
    'subject_id',
    'data_category',
    'flow_kind',
    'authentication_method',
    'principal_state',
    'provider',
    'reason',
    'source_ip',
    'request_id',
    'trace_id',
  ]) {
    assert.ok(variables.has(variable), `missing durable filter ${variable}`);
  }

  assert.doesNotMatch(JSON.stringify(value), /\bresult\b/i);
});

test('Grafana provisions the dedicated PostgreSQL reader without embedding credentials', async () => {
  for (const datasourceUrl of datasourceUrls) {
    const source = await readFile(datasourceUrl, 'utf8');
    const config = parse(source);
    const durable = config.datasources.find(
      (datasource) => datasource.uid === 'durable-records'
    );

    assert.equal(durable?.type, 'grafana-postgresql-datasource');
    assert.equal(durable?.user, '$GEUL_GRAFANA_POSTGRES_USER');
    assert.equal(
      durable?.secureJsonData?.password,
      '$GEUL_GRAFANA_POSTGRES_PASSWORD'
    );
    assert.equal(durable?.jsonData?.database, '$GEUL_POSTGRES_DATABASE');
    assert.equal(durable?.jsonData?.postgresVersion, 1800);
    assert.equal(durable?.jsonData?.maxOpenConns, 5);
    assert.equal(durable?.jsonData?.maxIdleConns, 2);
    assert.doesNotMatch(source, /postgres(?:ql)?:\/\//);
  }

  const compose = parse(await readFile(uiComposeUrl, 'utf8'));
  const environment = compose.services['grafana-prod'].environment;
  assert.ok(
    environment.includes(
      'GEUL_GRAFANA_POSTGRES_USER=${GEUL_GRAFANA_POSTGRES_USER}'
    )
  );
  assert.ok(
    environment.includes(
      'GEUL_GRAFANA_POSTGRES_PASSWORD=${GEUL_GRAFANA_POSTGRES_PASSWORD}'
    )
  );
});

test('Alloy promotes only bounded canonical log labels', async () => {
  for (const name of [
    'config.alloy',
    'config.prod.alloy',
    'config.test.alloy',
  ]) {
    const source = await readFile(
      new URL(`../../infra/alloy/${name}`, import.meta.url),
      'utf8'
    );

    assert.match(
      source,
      /service\.name,service\.namespace,deployment\.environment/
    );
    assert.match(source, /domain,outcome,retention_class,exporter/);
    assert.match(source, /action = "upsert"/);
    assert.match(source, /"retention_class"], "application"/);
    assert.match(source, /"retention_class"], "diagnostic"/);
    assert.doesNotMatch(
      source,
      /trace_id.*loki\.(?:resource|attribute)\.labels/
    );
  }
});

test('Alloy assigns Docker stdout to the system retention class', async () => {
  for (const name of [
    'config.alloy',
    'config.prod.alloy',
    'config.agent.app.alloy',
    'config.agent.worker.alloy',
  ]) {
    const source = await readFile(
      new URL(`../../infra/alloy/${name}`, import.meta.url),
      'utf8'
    );

    assert.match(source, /"retention_class" = "system"/);
  }
});

test('host Alloy uses runtime-provided endpoints and host identity', async () => {
  const source = await readFile(appAgentConfigUrl, 'utf8');
  const compose = parse(await readFile(agentComposeUrl, 'utf8'));

  assert.match(source, /url = sys\.env\("GEUL_LOKI_WRITE_URL"\)/);
  assert.match(source, /"host" = sys\.env\("GEUL_OBSERVABILITY_HOST"\)/);
  assert.match(
    source,
    /"deployment_environment" = sys\.env\("GEUL_DEPLOYMENT_ENVIRONMENT"\)/
  );

  assert.ok(
    compose.services['alloy-agent'].volumes.includes(
      '${GEUL_ALLOY_AGENT_CONFIG:-../infra/alloy/config.agent.app.alloy}:/etc/alloy/config.alloy:ro'
    )
  );
  assert.equal(
    compose.services['alloy-agent'].environment.GEUL_LOKI_WRITE_URL,
    '${GEUL_LOKI_WRITE_URL:?set GEUL_LOKI_WRITE_URL}'
  );
});

test('host agents exclude every owned OTLP service from Docker ingestion', async () => {
  const expected = new Map([
    ['config.agent.app.alloy', ['api', 'cdn', 'editor-collab', 'og', 'web']],
    [
      'config.agent.worker.alloy',
      ['asset-optimizer', 'cdn', 'og', 'transcoder', 'waveform-processor'],
    ],
  ]);

  for (const [name, services] of expected) {
    const source = await readFile(
      new URL(`../../infra/alloy/${name}`, import.meta.url),
      'utf8'
    );
    const dropPattern = source.match(
      /regex\s+= "\/\?geul-\(([^)]+)\)-\(dev\|prod\)"\s+action\s+= "drop"/
    )?.[1];

    assert.ok(dropPattern, `${name}: missing owned-service drop rule`);
    assert.deepEqual(dropPattern.split('|').sort(), services);
  }
});

test('Alloy sanitizes Kratos authentication span events before Tempo', async () => {
  const expectedSpanKeys = [
    'http.request.method',
    'http.response.status_code',
    'http.route',
    'http.method',
    'http.status_code',
  ];
  const expectedKeys = [
    'SelfServiceFlowType',
    'SelfServiceMethodUsed',
    'LoginRequestedAAL',
    'LoginRequestedPrivilegedSession',
    'SelfServiceSSOProviderUsed',
  ];
  let expectedSanitizer;

  for (const name of ['config.alloy', 'config.prod.alloy']) {
    const source = await readFile(
      new URL(`../../infra/alloy/${name}`, import.meta.url),
      'utf8'
    );
    const sanitizer = source.match(
      /otelcol\.processor\.transform "kratos_trace_sanitizer" \{[\s\S]*?\n\}/
    )?.[0];

    assert.ok(sanitizer, `${name}: missing Kratos trace sanitizer`);
    assert.match(
      source,
      /traces\s+= \[otelcol\.processor\.transform\.kratos_trace_sanitizer\.input\]/
    );
    assert.match(sanitizer, /error_mode = "propagate"/);
    assert.match(sanitizer, /context\s+= "spanevent"/);
    assert.match(
      sanitizer,
      /resource\.attributes\["service\.name"\] == "geul-kratos"/
    );
    assert.match(sanitizer, /\^\(Login\|Registration\|Session\)/);
    assert.match(
      sanitizer,
      /traces = \[otelcol\.exporter\.otlp\.tempo\.input\]/
    );

    const spanKeepKeys = sanitizer.match(
      /keep_keys\(span\.attributes, \[([^\]]+)\]\)/
    )?.[1];
    assert.ok(spanKeepKeys, `${name}: missing Kratos span attribute allowlist`);
    assert.deepEqual(
      [...spanKeepKeys.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      expectedSpanKeys
    );

    const keepKeys = sanitizer.match(
      /keep_keys\(spanevent\.attributes, \[([^\]]+)\]\)/
    )?.[1];
    assert.ok(keepKeys, `${name}: missing Kratos event attribute allowlist`);
    assert.deepEqual(
      [...keepKeys.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      expectedKeys
    );
    const retainedKeys = [...keepKeys.matchAll(/"([^"]+)"/g)].map(
      (match) => match[1]
    );
    assert.equal(
      retainedKeys.some((key) =>
        [
          'IdentityID',
          'SessionID',
          'FlowID',
          'Reason',
          'ErrorReason',
          'Error',
          'ClientIP',
          'WebhookRequestBody',
          'WebhookResponseBody',
          'JsonnetInput',
          'JsonnetOutput',
        ].includes(key)
      ),
      false
    );
    assert.match(
      sanitizer,
      /keep_keys\(spanevent\.attributes, \[\]\).*not IsMatch\(spanevent\.name, "\^\(Login\|Registration\|Session\)"\)/
    );

    const normalized = sanitizer.replace(/\s+/g, ' ').trim();
    expectedSanitizer ??= normalized;
    assert.equal(normalized, expectedSanitizer, `${name}: sanitizer drift`);
  }
});
