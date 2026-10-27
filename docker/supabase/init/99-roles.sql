-- Dev-only bootstrap for the local storage stack.
--
-- The `supabase/postgres` image ships the Supabase internal roles but leaves
-- them without a usable password. storage-api connects as
-- `supabase_storage_admin` and PostgREST connects as `authenticator`, both over
-- TCP, so both need the same password the container was started with.
--
-- Init scripts only run when the data directory is empty (first boot).

\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER USER authenticator WITH PASSWORD :'pgpass';
