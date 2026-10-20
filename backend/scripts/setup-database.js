#!/usr/bin/env node
/**
 * Build the blood_organ_network database from the SQL sources.
 *
 * Applies, in order:
 *   schema.sql  →  triggers.sql  →  procedures.sql  →  views.sql  →  seed.sql
 *
 * Usage:
 *   node scripts/setup-database.js              # full build, with seed data
 *   node scripts/setup-database.js --no-seed    # structure only
 *   node scripts/setup-database.js --quiet      # suppress per-file output
 *
 * Connection settings come from backend/.env (see .env.example).
 */
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from '../src/config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, '../sql');

const args = new Set(process.argv.slice(2));
const withSeed = !args.has('--no-seed');
const quiet = args.has('--quiet');

const log = (...parts) => { if (!quiet) console.log(...parts); };

const FILES = [
  { file: 'schema.sql',     label: 'Schema (tables, keys, constraints, indexes)' },
  { file: 'triggers.sql',   label: 'Triggers' },
  { file: 'procedures.sql', label: 'Stored procedures and functions' },
  { file: 'views.sql',      label: 'Views' },
  ...(withSeed ? [{ file: 'seed.sql', label: 'Seed data' }] : []),
];

/**
 * Split a script on the DELIMITER directive so routine bodies containing ';'
 * are sent to the server as single statements.
 */
/**
 * Remove a trailing `-- comment` from a line, ignoring any `--` that appears
 * inside a quoted string (bcrypt hashes and messages contain punctuation).
 */
function stripTrailingComment(line) {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const previous = line[i - 1];

    if (char === "'" && !inDouble && !inBacktick && previous !== '\\') inSingle = !inSingle;
    else if (char === '"' && !inSingle && !inBacktick && previous !== '\\') inDouble = !inDouble;
    else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (char === '-' && line[i + 1] === '-' && !inSingle && !inDouble && !inBacktick) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Split a script into executable statements, honouring the DELIMITER directive
 * so that routine bodies containing ';' are sent to the server intact.
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';
  let codeBuffer = '';

  for (const rawLine of sql.split('\n')) {
    const directive = rawLine.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      if (codeBuffer.trim()) statements.push(buffer.trim());
      buffer = '';
      codeBuffer = '';
      delimiter = directive[1];
      continue;
    }

    buffer += rawLine + '\n';
    codeBuffer += stripTrailingComment(rawLine) + '\n';

    if (codeBuffer.trimEnd().endsWith(delimiter)) {
      const code = codeBuffer.trimEnd().slice(0, -delimiter.length).trim();
      if (code) {
        // Re-assemble the statement without the trailing delimiter.
        const text = buffer.trimEnd();
        const cut = text.lastIndexOf(delimiter);
        statements.push(text.slice(0, cut).trim());
      }
      buffer = '';
      codeBuffer = '';
    }
  }

  if (codeBuffer.trim()) statements.push(buffer.trim());
  return statements.filter((statement) => statement.length > 0);
}

async function main() {
  log(`\nBlood & Organ Availability Network — database setup`);
  log(`Target: ${env.db.user}@${env.db.host}:${env.db.port}\n`);

  let connection;
  try {
    connection = await mysql.createConnection({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      multipleStatements: false,
    });
  } catch (error) {
    console.error(`\n  Could not connect to MySQL: ${error.message}`);
    console.error('  Check the DB_* values in backend/.env and that the server is running.\n');
    process.exit(1);
  }

  try {
    for (const { file, label } of FILES) {
      const fullPath = path.join(sqlDir, file);
      const sql = await fs.readFile(fullPath, 'utf8');
      const statements = splitStatements(sql);

      process.stdout.write(quiet ? '' : `  ${label.padEnd(48)} `);
      let executed = 0;
      for (const statement of statements) {
        try {
          await connection.query(statement);
          executed += 1;
        } catch (error) {
          console.error(`\n\n  Failed in ${file}:\n  ${error.message}`);
          console.error(`\n  Statement:\n${statement.slice(0, 400)}\n`);
          process.exit(1);
        }
      }
      log(`ok (${executed} statements)`);
    }

    const [[counts]] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema='blood_organ_network' AND table_type='BASE TABLE') AS tables_n,
        (SELECT COUNT(*) FROM information_schema.views
          WHERE table_schema='blood_organ_network') AS views_n,
        (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_schema='blood_organ_network' AND routine_type='PROCEDURE') AS procs,
        (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_schema='blood_organ_network' AND routine_type='FUNCTION') AS funcs,
        (SELECT COUNT(*) FROM information_schema.triggers
          WHERE trigger_schema='blood_organ_network') AS triggers_n,
        (SELECT COUNT(*) FROM information_schema.referential_constraints
          WHERE constraint_schema='blood_organ_network') AS fks,
        (SELECT COUNT(*) FROM information_schema.check_constraints
          WHERE constraint_schema='blood_organ_network') AS checks_n`);

    log(`\n  Database objects created:`);
    log(`    tables ${counts.tables_n} · views ${counts.views_n} · procedures ${counts.procs} · ` +
        `functions ${counts.funcs} · triggers ${counts.triggers_n} · ` +
        `foreign keys ${counts.fks} · CHECK constraints ${counts.checks_n}`);

    if (withSeed) {
      log(`\n  Demo accounts:`);
      log(`    admin@bon.health      / Admin@123     (administrator)`);
      log(`    donor@bon.health      / Password@123  (donor)`);
      log(`    recipient@bon.health  / Password@123  (patient)`);
      log(`    hospital@bon.health   / Password@123  (hospital)`);
      log(`    bloodbank@bon.health  / Password@123  (blood bank)`);
      log(`    transplant@bon.health / Password@123  (transplant centre)`);
    }
    log(`\n  Done.\n`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('\nSetup failed:', error.message, '\n');
  process.exit(1);
});
