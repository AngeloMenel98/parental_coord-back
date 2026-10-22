import { AlignSystemRoleAndReportStatusEnums1792555200000 } from '../migrations/1792555200000-AlignSystemRoleAndReportStatusEnums';

/**
 * Tests ESTRUCTURALES de la migración AlignSystemRoleAndReportStatusEnums
 * (deriva: los enums del código no coinciden con los de la migración inicial).
 * Sin Postgres en CI se protege la FORMA: los guards idempotentes en pg_enum,
 * el orden DROP DEFAULT → CREATE → USING → DROP → RENAME → SET DEFAULT, y los
 * mapeos explícitos de valores en ambos sentidos.
 */
describe('1792555200000-AlignSystemRoleAndReportStatusEnums migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('guards both enum rebuilds on pg_enum so a retry never aborts', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sqlOf(qr.query)).toHaveLength(2);
      expect(sql).toContain("t.typname = 'system_role' AND e.enumlabel = 'user'");
      expect(sql).toContain("t.typname = 'report_status' AND e.enumlabel = 'requested'");
      expect(sql).toContain('pg_enum');
    });

    it('system_role: drops the default before rebuilding and maps admin/user explicitly', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().up(qr as any);
      const sql = sqlOf(qr.query)[0];
      expect(sql.indexOf('DROP DEFAULT')).toBeLessThan(sql.indexOf('CREATE TYPE'));
      expect(sql).toContain("CREATE TYPE \"system_role_aligned\" AS ENUM ('user', 'admin')");
      expect(sql).toContain(`WHEN 'admin' THEN 'admin'`);
      expect(sql).toContain(`ELSE 'user'`);
      expect(sql).toContain(') ::"system_role_aligned"'.replace(' ', ''));
    });

    it('system_role: drops the old type, renames the new one, sets an untyped default', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().up(qr as any);
      const sql = sqlOf(qr.query)[0];
      const dropOld = sql.indexOf('DROP TYPE "system_role";');
      const rename = sql.indexOf('ALTER TYPE "system_role_aligned" RENAME TO "system_role"');
      const setDefault = sql.indexOf(`SET DEFAULT 'user'`);
      expect(dropOld).toBeGreaterThan(-1);
      expect(rename).toBeGreaterThan(dropOld);
      expect(setDefault).toBeGreaterThan(rename);
      // literal crudo sin cast: sobrevive al rename del tipo
      expect(sql).not.toContain(`SET DEFAULT 'user'::`);
    });

    it('report_status: maps every legacy Spanish value to its ReportStatus literal', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().up(qr as any);
      const sql = sqlOf(qr.query)[1];
      expect(sql).toContain("CREATE TYPE \"report_status_aligned\" AS ENUM ('requested', 'in_progress', 'completed', 'delivered')");
      expect(sql).toContain(`WHEN 'solicitado'  THEN 'requested'`);
      expect(sql).toContain(`WHEN 'en_proceso'  THEN 'in_progress'`);
      expect(sql).toContain(`WHEN 'completado'  THEN 'completed'`);
      expect(sql).toContain(`WHEN 'entregado'   THEN 'delivered'`);
      expect(sql).toContain(`SET DEFAULT 'requested'`);
    });

    it('rebuilds report_status in the same DROP→RENAME→DEFAULT order', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().up(qr as any);
      const sql = sqlOf(qr.query)[1];
      const dropOld = sql.indexOf('DROP TYPE "report_status";');
      const rename = sql.indexOf('ALTER TYPE "report_status_aligned" RENAME TO "report_status"');
      const setDefault = sql.indexOf(`SET DEFAULT 'requested'`);
      expect(dropOld).toBeGreaterThan(-1);
      expect(rename).toBeGreaterThan(dropOld);
      expect(setDefault).toBeGreaterThan(rename);
    });
  });

  describe('down()', () => {
    it('restores the initial-schema literals with reverse mappings', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain("CREATE TYPE \"system_role_legacy\" AS ENUM ('progenitor', 'admin')");
      expect(sql).toContain(`ELSE 'progenitor'`);
      expect(sql).toContain(`SET DEFAULT 'progenitor'`);
      expect(sql).toContain("CREATE TYPE \"report_status_legacy\" AS ENUM ('solicitado', 'en_proceso', 'completado', 'entregado')");
      expect(sql).toContain(`WHEN 'requested'    THEN 'solicitado'`);
      expect(sql).toContain(`WHEN 'in_progress'  THEN 'en_proceso'`);
      expect(sql).toContain(`SET DEFAULT 'solicitado'`);
    });

    it('guards down() reversibly (retry-safe on the legacy labels)', async () => {
      await new AlignSystemRoleAndReportStatusEnums1792555200000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain("t.typname = 'system_role' AND e.enumlabel = 'progenitor'");
      expect(sql).toContain("t.typname = 'report_status' AND e.enumlabel = 'solicitado'");
    });
  });
});
