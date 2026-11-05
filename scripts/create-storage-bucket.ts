/**
 * Idempotent bucket bootstrap for activity attachments.
 *
 * Replaces the former `supabase-init` compose service: it targets Supabase
 * Cloud Storage and can be re-run safely, converging an existing bucket to the
 * limits declared in the environment.
 *
 * Usage:  pnpm storage:init
 *         ENV_FILE=.env.local pnpm storage:init
 * Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *         SUPABASE_STORAGE_BUCKET_ACTIVITY_ATTACHMENTS, ATTACHMENTS_MAX_SIZE_BYTES
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), process.env.ENV_FILE ?? '.env') });

/** Must stay aligned with ALLOWED_EXT in activity-attachments.service.ts. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_ACTIVITY_ATTACHMENTS || 'activity-attachments';
  const fileSizeLimit = Number(process.env.ATTACHMENTS_MAX_SIZE_BYTES ?? 10485760);

  if (!url || !serviceRoleKey) {
    console.error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n' +
        'Copy .env.example to .env and paste the values from Project Settings > API.',
    );
    process.exit(1);
  }

  const supabase = (() => {
    try {
      return createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    } catch (error) {
      console.error(`Could not create the Supabase client: ${(error as Error).message}`);
      console.error('This script requires Node 22+ (no global WebSocket on Node 20).');
      process.exit(1);
    }
  })();

  const options = {
    public: false,
    fileSizeLimit,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  };

  const created = await supabase.storage.createBucket(bucket, options);
  if (!created.error) {
    console.log(`Bucket "${bucket}" created (private, ${fileSizeLimit} bytes max).`);
    return;
  }

  // createBucket fails when the bucket already exists, so converge instead.
  const updated = await supabase.storage.updateBucket(bucket, options);
  if (updated.error) {
    console.error(`Could not create or update bucket "${bucket}".`);
    console.error(`  create: ${created.error.message}`);
    console.error(`  update: ${updated.error.message}`);
    process.exit(1);
  }

  console.log(
    `Bucket "${bucket}" already existed; limits updated (private, ${fileSizeLimit} bytes max).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
