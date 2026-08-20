import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';
import type { DurableClaim } from './claims';
import type { ImprovementCandidate } from './candidateManager';
import type { FailureRecord } from './failureLearning';
import type { GrowthGoal } from './growthPlanner';
import type { NightCycleReport } from './nightCycle';
import type { ReflectionRecord } from './reflectionEngine';
import type { CapabilityAssessment } from './selfModel';
import type { ExperienceRecord, ProceduralSkillVersion } from './types';

import type { JsonCollection } from './persistTypes';

export type { JsonCollection } from './persistTypes';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS json_docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(collection, id)
);
`;

export function defaultEvolutionDbPath(workspaceRoot = process.cwd()): string {
  return path.join(defaultRuntimeRoot(workspaceRoot), 'evolution.db');
}

export class EvolutionPersistence {
  public readonly dbPath: string;
  private readonly db: DatabaseSync;

  public readonly experiences: JsonCollection<ExperienceRecord>;
  public readonly reflections: JsonCollection<ReflectionRecord>;
  public readonly failures: JsonCollection<FailureRecord>;
  public readonly selfModel: JsonCollection<CapabilityAssessment>;
  public readonly growth: JsonCollection<GrowthGoal>;
  public readonly skills: JsonCollection<ProceduralSkillVersion>;
  public readonly candidates: JsonCollection<ImprovementCandidate>;
  public readonly claims: JsonCollection<DurableClaim>;
  public readonly night: JsonCollection<NightCycleReport & { id: string }>;

  constructor(dbPath: string) {
    const opened = openOperationalSqlite(dbPath, 'Evolution store');
    this.db = opened.db;
    this.dbPath = opened.path;
    this.db.exec(SCHEMA);
    const current = Number(this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0);
    if (current < SCHEMA_VERSION) {
      this.db.prepare('INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)').run(
        SCHEMA_VERSION,
        new Date().toISOString(),
        'evolution v1',
      );
    }
    this.experiences = this.collection('experiences', item => item.id);
    this.reflections = this.collection('reflections', item => `${item.experienceId}:${item.trigger}`);
    this.failures = this.collection('failures', item => item.signature);
    this.selfModel = this.collection('self_model', item => item.capability);
    this.growth = this.collection('growth', item => item.id);
    this.skills = this.collection('skills', item => `${item.skillId}:${item.version}`);
    this.candidates = this.collection('candidates', item => item.id);
    this.claims = this.collection('claims', item => item.id);
    this.night = this.collection('night', item => item.id);
  }

  public close(): void {
    this.db.close();
  }

  private collection<T>(name: string, idOf: (item: T) => string): JsonCollection<T> {
    return {
      load: () => {
        const rows = this.db.prepare('SELECT payload FROM json_docs WHERE collection = ?').all(name) as Array<{ payload: string }>;
        return rows.map(row => JSON.parse(String(row.payload)) as T);
      },
      replace: (items: T[]) => {
        this.db.exec('BEGIN');
        try {
          this.db.prepare('DELETE FROM json_docs WHERE collection = ?').run(name);
          const insert = this.db.prepare('INSERT INTO json_docs(collection, id, payload, updated_at) VALUES (?, ?, ?, ?)');
          const at = new Date().toISOString();
          for (const item of items) {
            insert.run(name, idOf(item), JSON.stringify(item), at);
          }
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }
}
