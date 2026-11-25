import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE sovereign_control_state (
      id TEXT PRIMARY KEY CHECK (id = 'global'),
      emergency_stop_active INTEGER NOT NULL DEFAULT 0,
      emergency_stop_reason TEXT,
      emergency_stop_at TEXT,
      reporting_currency TEXT NOT NULL DEFAULT 'GBP',
      global_monthly_budget_minor INTEGER NOT NULL DEFAULT 0,
      default_paid_fallback_mode TEXT NOT NULL DEFAULT 'deny',
      prompt_injection_guard_enabled INTEGER NOT NULL DEFAULT 1,
      fx_rates_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO sovereign_control_state (
      id,
      emergency_stop_active,
      emergency_stop_reason,
      emergency_stop_at,
      reporting_currency,
      global_monthly_budget_minor,
      default_paid_fallback_mode,
      prompt_injection_guard_enabled,
      fx_rates_json,
      revision,
      updated_at
    ) VALUES (
      'global',
      0,
      NULL,
      NULL,
      'GBP',
      0,
      'deny',
      1,
      '{"GBP":1,"USD":0.79,"EUR":0.86}',
      0,
      '1970-01-01T00:00:00.000Z'
    )
  `;

  yield* sql`
    CREATE TABLE sovereign_ventures (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      template_key TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      ui_modules_json TEXT NOT NULL,
      budget_policy_json TEXT NOT NULL,
      permission_policy_json TEXT NOT NULL,
      routing_policy_json TEXT NOT NULL,
      linked_project_ids_json TEXT NOT NULL DEFAULT '[]',
      linked_thread_ids_json TEXT NOT NULL DEFAULT '[]',
      linked_scheduled_task_ids_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_ventures_status_idx ON sovereign_ventures (status, updated_at)`;

  yield* sql`
    CREATE TABLE sovereign_objectives (
      id TEXT PRIMARY KEY,
      venture_id TEXT REFERENCES sovereign_ventures(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      horizon TEXT NOT NULL,
      target_revenue_minor INTEGER,
      max_spend_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GBP',
      target_deadline_at TEXT,
      strategy_plan_json TEXT,
      constraints_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_objectives_venture_idx ON sovereign_objectives (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_opportunities (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      objective_id TEXT REFERENCES sovereign_objectives(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      source_url TEXT,
      external_id TEXT,
      stage TEXT NOT NULL,
      eligibility_status TEXT NOT NULL,
      eligibility_notes TEXT,
      automation_mode TEXT NOT NULL,
      ai_permission_status TEXT NOT NULL,
      estimated_value_minor INTEGER,
      currency TEXT NOT NULL DEFAULT 'GBP',
      score_json TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      deadline_at TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX sovereign_opportunities_venture_external_uidx
    ON sovereign_opportunities (venture_id, external_id)
    WHERE external_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX sovereign_opportunities_venture_stage_idx
    ON sovereign_opportunities (venture_id, stage, updated_at)
  `;

  yield* sql`
    CREATE TABLE sovereign_tasks (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      objective_id TEXT REFERENCES sovereign_objectives(id) ON DELETE SET NULL,
      opportunity_id TEXT REFERENCES sovereign_opportunities(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      complexity TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      assigned_provider_instance_id TEXT,
      assigned_model TEXT,
      linked_thread_id TEXT,
      linked_run_id TEXT,
      pending_approval_id TEXT,
      routing_policy_override_json TEXT,
      blocked_reason TEXT,
      idempotency_key TEXT,
      checkpoint_json TEXT,
      handoff_summary TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX sovereign_tasks_idempotency_uidx
    ON sovereign_tasks (idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX sovereign_tasks_venture_status_idx
    ON sovereign_tasks (venture_id, status, priority DESC)
  `;

  yield* sql`
    CREATE TABLE sovereign_artifacts (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES sovereign_tasks(id) ON DELETE SET NULL,
      opportunity_id TEXT REFERENCES sovereign_opportunities(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      uri TEXT,
      mime_type TEXT,
      sha256 TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_artifacts_venture_idx ON sovereign_artifacts (venture_id, created_at DESC)`;
  yield* sql`CREATE INDEX sovereign_artifacts_task_idx ON sovereign_artifacts (task_id)`;

  yield* sql`
    CREATE TABLE sovereign_leads (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT,
      phone TEXT,
      website_url TEXT,
      source TEXT NOT NULL,
      stage TEXT NOT NULL,
      consents_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_leads_venture_idx ON sovereign_leads (venture_id, stage)`;

  yield* sql`
    CREATE TABLE sovereign_customers (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES sovereign_leads(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL,
      consents_json TEXT NOT NULL DEFAULT '[]',
      billing_currency TEXT NOT NULL DEFAULT 'GBP',
      lifetime_collected_minor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_customers_venture_idx ON sovereign_customers (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_proposals (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES sovereign_leads(id) ON DELETE SET NULL,
      customer_id TEXT REFERENCES sovereign_customers(id) ON DELETE SET NULL,
      opportunity_id TEXT REFERENCES sovereign_opportunities(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      line_items_json TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      discount_pct REAL NOT NULL DEFAULT 0,
      total_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL,
      approval_id TEXT,
      valid_until TEXT,
      sent_at TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_proposals_venture_idx ON sovereign_proposals (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_orders (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES sovereign_customers(id) ON DELETE CASCADE,
      proposal_id TEXT REFERENCES sovereign_proposals(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_orders_venture_idx ON sovereign_orders (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_invoices (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES sovereign_customers(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES sovereign_orders(id) ON DELETE SET NULL,
      invoice_number TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      paid_amount_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL,
      payment_link_url TEXT,
      external_invoice_id TEXT,
      issued_at TEXT,
      due_at TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_invoices_venture_idx ON sovereign_invoices (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_payment_links (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      invoice_id TEXT REFERENCES sovereign_invoices(id) ON DELETE SET NULL,
      integration_id TEXT,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_payment_links_venture_idx ON sovereign_payment_links (venture_id)`;

  yield* sql`
    CREATE TABLE sovereign_communications (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES sovereign_leads(id) ON DELETE SET NULL,
      customer_id TEXT REFERENCES sovereign_customers(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      ai_disclosed INTEGER NOT NULL DEFAULT 0,
      consent_verified INTEGER NOT NULL DEFAULT 0,
      subject TEXT,
      body_preview TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      approval_id TEXT,
      external_message_id TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_communications_venture_idx ON sovereign_communications (venture_id, created_at DESC)`;

  yield* sql`
    CREATE TABLE sovereign_support_tickets (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES sovereign_customers(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES sovereign_orders(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      handled_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `;
  yield* sql`CREATE INDEX sovereign_support_tickets_venture_idx ON sovereign_support_tickets (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_voice_agents (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider_integration_id TEXT,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      phone_number_label TEXT,
      ai_disclosure_greeting TEXT NOT NULL,
      recording_disclosure_enabled INTEGER NOT NULL DEFAULT 1,
      opt_out_phrase_enabled INTEGER NOT NULL DEFAULT 1,
      escalation_number_label TEXT,
      script_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_voice_agents_venture_idx ON sovereign_voice_agents (venture_id, status)`;

  yield* sql`
    CREATE TABLE sovereign_ledger_entries (
      id TEXT PRIMARY KEY,
      venture_id TEXT REFERENCES sovereign_ventures(id) ON DELETE SET NULL,
      order_id TEXT REFERENCES sovereign_orders(id) ON DELETE SET NULL,
      invoice_id TEXT REFERENCES sovereign_invoices(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES sovereign_tasks(id) ON DELETE SET NULL,
      integration_id TEXT,
      entry_type TEXT NOT NULL,
      verification_state TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      reporting_amount_gbp_minor INTEGER NOT NULL,
      fx_rate_to_gbp REAL NOT NULL,
      description TEXT NOT NULL,
      external_ref TEXT,
      recorded_by TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX sovereign_ledger_entries_external_ref_uidx
    ON sovereign_ledger_entries (external_ref)
    WHERE external_ref IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX sovereign_ledger_entries_venture_idx
    ON sovereign_ledger_entries (venture_id, verification_state, occurred_at DESC)
  `;

  yield* sql`
    CREATE TABLE sovereign_preapproval_policies (
      id TEXT PRIMARY KEY,
      venture_id TEXT REFERENCES sovereign_ventures(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      max_single_action_minor INTEGER,
      max_monthly_aggregate_minor INTEGER,
      currency TEXT NOT NULL DEFAULT 'GBP',
      allowed_targets_json TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX sovereign_preapproval_policies_lookup_idx
    ON sovereign_preapproval_policies (venture_id, category, enabled)
  `;

  yield* sql`
    CREATE TABLE sovereign_approvals (
      id TEXT PRIMARY KEY,
      venture_id TEXT REFERENCES sovereign_ventures(id) ON DELETE SET NULL,
      objective_id TEXT REFERENCES sovereign_objectives(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES sovereign_tasks(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      requested_action TEXT NOT NULL,
      target_label TEXT,
      estimated_cost_minor INTEGER,
      currency TEXT,
      payload_json TEXT,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT,
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT,
      preapproval_policy_id TEXT REFERENCES sovereign_preapproval_policies(id) ON DELETE SET NULL,
      idempotency_key TEXT
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX sovereign_approvals_idempotency_uidx
    ON sovereign_approvals (idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX sovereign_approvals_status_idx
    ON sovereign_approvals (status, venture_id, requested_at DESC)
  `;

  yield* sql`
    CREATE TABLE sovereign_integrations (
      id TEXT PRIMARY KEY,
      venture_id TEXT REFERENCES sovereign_ventures(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sandbox_mode INTEGER NOT NULL DEFAULT 0,
      endpoint_url TEXT,
      account_label TEXT,
      has_secret INTEGER NOT NULL DEFAULT 0,
      secret_reference_json TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      last_tested_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_integrations_venture_idx ON sovereign_integrations (venture_id, category)`;

  yield* sql`
    CREATE TABLE sovereign_audit_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      venture_id TEXT,
      actor TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT,
      approval_id TEXT,
      task_id TEXT,
      provider_instance_id TEXT,
      integration_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX sovereign_audit_events_created_idx ON sovereign_audit_events (created_at DESC)`;
  yield* sql`CREATE INDEX sovereign_audit_events_venture_idx ON sovereign_audit_events (venture_id, kind, created_at DESC)`;

  yield* sql`
    CREATE TABLE sovereign_webhook_replay_keys (
      integration_id TEXT NOT NULL REFERENCES sovereign_integrations(id) ON DELETE CASCADE,
      replay_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY (integration_id, replay_key)
    )
  `;
});
