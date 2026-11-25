import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import workflowMailSender from "../persistence/Migrations/117_WorkflowMailSender.ts";
import commercialOS from "./migrations/001_CommercialOS.ts";

const run = Migrator.make({});

export const hasPendingCommercialMigrations = Effect.fn("hasPendingCommercialMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables =
      yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sovereign_sql_migrations'`;
    if (!tables.length) return true;
    const rows = yield* sql`SELECT 1 FROM sovereign_sql_migrations WHERE migration_id = 1`;
    return !rows.length;
  },
);

export const reconcileLegacyCommercialMigration = Effect.fn("reconcileLegacyCommercialMigration")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const history =
      yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'`;
    if (!history.length) return;
    const legacy =
      yield* sql`SELECT 1 FROM effect_sql_migrations WHERE migration_id = 117 AND name = 'sovereign_commercial_os'`;
    if (!legacy.length) return;
    // The original fork recorded its commercial schema at the upstream mail migration's id.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const claimed = yield* sql`UPDATE effect_sql_migrations SET name = 'WorkflowMailSender'
      WHERE migration_id = 117 AND name = 'sovereign_commercial_os' RETURNING migration_id`;
        if (claimed.length) yield* workflowMailSender;
      }),
    );
  },
);

export const runCommercialMigrations = () =>
  run({
    table: "sovereign_sql_migrations",
    loader: Migrator.fromRecord({
      "1_CommercialOS": Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const existing =
          yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sovereign_control_state'`;
        if (!existing.length) yield* commercialOS;
      }),
    }),
  });
