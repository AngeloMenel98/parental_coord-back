import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema — Sistema de Coordinación Parental.
 *
 * Implements the full revised ERD (see /home/angelo/ERD_REVISADO.md):
 *   user, personal_data, bond, bond_member, children, activity,
 *   activity_child, act_attachment, expense, expense_attachment,
 *   auth_third_party, third_activity_participation, report, notification,
 *   audit_log.
 *
 * Table names match the TypeORM entity naming so the TDD-generated
 * `migration:diff` stays clean.
 */
export class InitialSchema1785503810000 implements MigrationInterface {
  name = 'InitialSchema1785503810000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- ENUMS ----
    await queryRunner.query(
      `CREATE TYPE "system_role" AS ENUM ('progenitor', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE "bond_member_role" AS ENUM ('progenitor', 'coordinador')`,
    );
    await queryRunner.query(
      `CREATE TYPE "agreement_type" AS ENUM ('formal', 'informal')`,
    );
    await queryRunner.query(
      `CREATE TYPE "activity_type" AS ENUM ('event', 'obligation')`,
    );
    await queryRunner.query(
      `CREATE TYPE "activity_status" AS ENUM ('created', 'assigned', 'in_progress', 'verify', 'done', 'overdue', 'objection', 'dispute')`,
    );
    await queryRunner.query(
      `CREATE TYPE "criticality" AS ENUM ('critical', 'high', 'medium', 'low')`,
    );
    await queryRunner.query(
      `CREATE TYPE "activity_category" AS ENUM ('salud', 'educacion', 'social', 'familiar', 'recreacion')`,
    );
    await queryRunner.query(
      `CREATE TYPE "expense_status" AS ENUM ('pending', 'approved', 'rejected', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth_third_status" AS ENUM ('active', 'suspended', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TYPE "participation_status" AS ENUM ('asignado', 'confirmado', 'rechazado', 'completado')`,
    );
    await queryRunner.query(
      `CREATE TYPE "report_status" AS ENUM ('solicitado', 'en_proceso', 'completado', 'entregado')`,
    );

    // ---- USER & PROFILE ----
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "system_role" "system_role" NOT NULL DEFAULT 'progenitor', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_user_email" UNIQUE ("email"), CONSTRAINT "PK_user_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "personal_data" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "phone" character varying(30), "avatar_url" text, "date_of_birth" date, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_personal_data_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "personal_data" ADD CONSTRAINT "FK_personal_data_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_personal_data_user_id" ON "personal_data" ("user_id")`,
    );

    // ---- BONDS ----
    await queryRunner.query(
      `CREATE TABLE "bond" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "title" character varying(255) NOT NULL, "agreement_type" "agreement_type" NOT NULL, "court_case_ref" character varying(255), "start_date" date, "end_date" date, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bond_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "bond_member" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "bond_member_role" NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE, "left_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bond_member_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bond_member" ADD CONSTRAINT "FK_bond_member_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "bond_member" ADD CONSTRAINT "FK_bond_member_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bond_member_bond" ON "bond_member" ("bond_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bond_member_user" ON "bond_member" ("user_id")`,
    );

    // ---- CHILDREN ----
    await queryRunner.query(
      `CREATE TABLE "children" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "date_of_birth" date, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_children_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "children" ADD CONSTRAINT "FK_children_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_children_bond" ON "children" ("bond_id")`,
    );

    // ---- ACTIVITIES ----
    await queryRunner.query(
      `CREATE TABLE "activity" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "category" "activity_category" NOT NULL, "type" "activity_type" NOT NULL, "status" "activity_status" NOT NULL DEFAULT 'created', "criticality" "criticality" NOT NULL DEFAULT 'medium', "title" character varying(255) NOT NULL, "description" text NOT NULL, "created_by" uuid NOT NULL, "assigned_to" uuid, "scheduled_start" TIMESTAMP WITH TIME ZONE, "scheduled_end" TIMESTAMP WITH TIME ZONE, "deadline" TIMESTAMP WITH TIME ZONE, "notif_before" interval, "notif_after" interval, "assigned_confirmed" boolean NOT NULL DEFAULT false, "confirmed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "completed_at" TIMESTAMP WITH TIME ZONE, "resolved_status" "activity_status", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_activity_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity" ADD CONSTRAINT "FK_activity_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity" ADD CONSTRAINT "FK_activity_created_by" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity" ADD CONSTRAINT "FK_activity_assigned_to" FOREIGN KEY ("assigned_to") REFERENCES "user"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_bond" ON "activity" ("bond_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_assigned" ON "activity" ("assigned_to")`,
    );

    await queryRunner.query(
      `CREATE TABLE "activity_child" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "activity_id" uuid NOT NULL, "child_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_activity_child_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity_child" ADD CONSTRAINT "FK_activity_child_activity_id" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "activity_child" ADD CONSTRAINT "FK_activity_child_child_id" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_activity_child_pair" ON "activity_child" ("activity_id", "child_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "act_attachment" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "activity_id" uuid NOT NULL, "file_url" text NOT NULL, "file_name" character varying(255) NOT NULL, "file_type" character varying(50) NOT NULL, "uploaded_by" uuid NOT NULL, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_act_attachment_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "act_attachment" ADD CONSTRAINT "FK_act_attachment_activity_id" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "act_attachment" ADD CONSTRAINT "FK_act_attachment_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );

    // ---- EXPENSES ----
    await queryRunner.query(
      `CREATE TABLE "expense" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "child_id" uuid, "concept" character varying(255) NOT NULL, "description" text, "amount" numeric(12,2) NOT NULL, "expense_date" date NOT NULL, "split_ratio_payer" numeric(5,2) NOT NULL, "split_ratio_other" numeric(5,2) NOT NULL, "status" "expense_status" NOT NULL DEFAULT 'pending', "requested_by" uuid NOT NULL, "approved_by" uuid, "approved_at" TIMESTAMP WITH TIME ZONE, "paid_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_expense_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense" ADD CONSTRAINT "FK_expense_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense" ADD CONSTRAINT "FK_expense_child_id" FOREIGN KEY ("child_id") REFERENCES "children"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense" ADD CONSTRAINT "FK_expense_requested_by" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense" ADD CONSTRAINT "FK_expense_approved_by" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_expense_bond" ON "expense" ("bond_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "expense_attachment" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "expense_id" uuid NOT NULL, "file_url" text NOT NULL, "file_name" character varying(255) NOT NULL, "file_type" character varying(50) NOT NULL, "uploaded_by" uuid NOT NULL, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_expense_attachment_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_attachment" ADD CONSTRAINT "FK_expense_attachment_expense_id" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_attachment" ADD CONSTRAINT "FK_expense_attachment_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );

    // ---- THIRD PARTY ----
    await queryRunner.query(
      `CREATE TABLE "auth_third_party" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "user_id" uuid NOT NULL, "authorized_by" uuid NOT NULL, "start_date" date, "end_date" date, "status" "auth_third_status" NOT NULL DEFAULT 'active', "scope_note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_auth_third_party_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD CONSTRAINT "FK_auth_third_party_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD CONSTRAINT "FK_auth_third_party_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD CONSTRAINT "FK_auth_third_party_authorized_by" FOREIGN KEY ("authorized_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `CREATE TABLE "third_activity_participation" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "auth_third_id" uuid NOT NULL, "activity_id" uuid NOT NULL, "participation_status" "participation_status" NOT NULL DEFAULT 'asignado', "confirmed_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_third_activity_participation_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "third_activity_participation" ADD CONSTRAINT "FK_tap_auth_third_id" FOREIGN KEY ("auth_third_id") REFERENCES "auth_third_party"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "third_activity_participation" ADD CONSTRAINT "FK_tap_activity_id" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE`,
    );

    // ---- REPORTS ----
    await queryRunner.query(
      `CREATE TABLE "report" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "bond_id" uuid NOT NULL, "requested_by" uuid NOT NULL, "generated_by" uuid, "date_from" date NOT NULL, "date_to" date NOT NULL, "status" "report_status" NOT NULL DEFAULT 'solicitado', "file_url" text, "generated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_report_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "report" ADD CONSTRAINT "FK_report_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "report" ADD CONSTRAINT "FK_report_requested_by" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "report" ADD CONSTRAINT "FK_report_generated_by" FOREIGN KEY ("generated_by") REFERENCES "user"("id") ON DELETE SET NULL`,
    );

    // ---- NOTIFICATIONS ----
    await queryRunner.query(
      `CREATE TABLE "notification" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "bond_id" uuid, "type" character varying(50) NOT NULL, "title" character varying(255) NOT NULL, "body" text NOT NULL, "ref_entity_type" character varying(50) NOT NULL, "ref_entity_id" uuid, "is_read" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_notification_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_notification_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_user" ON "notification" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_ref_entity" ON "notification" ("ref_entity_id")`,
    );

    // ---- AUDIT LOG ----
    await queryRunner.query(
      `CREATE TABLE "audit_log" ("id" BIGSERIAL NOT NULL, "bond_id" uuid, "user_id" uuid NOT NULL, "entity_type" character varying(50) NOT NULL, "entity_id" uuid, "action" character varying(50) NOT NULL, "old_value" jsonb, "new_value" jsonb, "detail" text, "ip_address" character varying(45), "user_agent" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_audit_log_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "FK_audit_bond_id" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "FK_audit_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_bond" ON "audit_log" ("bond_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_entity" ON "audit_log" ("entity_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(`DROP TABLE "report"`);
    await queryRunner.query(`DROP TABLE "third_activity_participation"`);
    await queryRunner.query(`DROP TABLE "auth_third_party"`);
    await queryRunner.query(`DROP TABLE "expense_attachment"`);
    await queryRunner.query(`DROP TABLE "expense"`);
    await queryRunner.query(`DROP TABLE "act_attachment"`);
    await queryRunner.query(`DROP TABLE "activity_child"`);
    await queryRunner.query(`DROP TABLE "activity"`);
    await queryRunner.query(`DROP TABLE "children"`);
    await queryRunner.query(`DROP TABLE "bond_member"`);
    await queryRunner.query(`DROP TABLE "bond"`);
    await queryRunner.query(`DROP TABLE "personal_data"`);
    await queryRunner.query(`DROP TABLE "user"`);

    await queryRunner.query(`DROP TYPE "report_status"`);
    await queryRunner.query(`DROP TYPE "participation_status"`);
    await queryRunner.query(`DROP TYPE "auth_third_status"`);
    await queryRunner.query(`DROP TYPE "expense_status"`);
    await queryRunner.query(`DROP TYPE "activity_category"`);
    await queryRunner.query(`DROP TYPE "criticality"`);
    await queryRunner.query(`DROP TYPE "activity_status"`);
    await queryRunner.query(`DROP TYPE "activity_type"`);
    await queryRunner.query(`DROP TYPE "agreement_type"`);
    await queryRunner.query(`DROP TYPE "bond_member_role"`);
    await queryRunner.query(`DROP TYPE "system_role"`);
  }
}
