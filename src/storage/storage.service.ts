import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly supabase: SupabaseClient | null = null;
  private readonly bucket: string;
  /** B3 · bucket de los PDFs generados; nunca el de adjuntos de actividad. */
  private readonly reportsBucket: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket =
      this.config.get<string>('SUPABASE_STORAGE_BUCKET_ACTIVITY_ATTACHMENTS') ||
      'activity-attachments';
    this.reportsBucket = this.config.get<string>('SUPABASE_STORAGE_BUCKET_REPORTS') || 'reports';
    if (url && key) {
      try {
        this.supabase = createClient(url, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
      } catch (e) {
        this.logger.warn(`Failed to init Supabase client: ${e}`);
      }
    }
  }

  getBucket(): string {
    return this.bucket;
  }

  isEnabled(): boolean {
    return !!this.supabase;
  }

  async createSignedUploadUrl(path: string): Promise<{ signedUrl: string; path: string } | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.signedUrl) {
      this.logger.warn(`createSignedUploadUrl error: ${error?.message}`);
      return null;
    }
    // createSignedUploadUrl already returns its own signed URL: the expiry is not ours.
    return { signedUrl: data.signedUrl, path };
  }

  async objectExists(path: string): Promise<boolean> {
    if (!this.supabase) return false;
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop()!;
    const { data, error } = await this.supabase.storage.from(this.bucket).list(dir, {
      search: name,
      limit: 1,
    });
    if (error) return false;
    return !!(data && data.some((f) => f.name === name));
  }

  async createSignedDownloadUrl(path: string, expiresIn = 900): Promise<string | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      this.logger.warn(`createSignedDownloadUrl error: ${error?.message}`);
      return null;
    }
    return data.signedUrl;
  }

  async removeObject(path: string): Promise<boolean> {
    if (!this.supabase) return false;
    const { error } = await this.supabase.storage.from(this.bucket).remove([path]);
    if (error) {
      this.logger.warn(`removeObject error: ${error?.message}`);
      return false;
    }
    return true;
  }

  /**
   * B3 · S11 — sube bytes generados por el servidor al bucket de reportes.
   *
   * Devuelve el path guardado (no una URL): `report.file_url` guarda el path y la
   * URL firmada se emite en cada lectura, igual que en los adjuntos. `upsert:
   * true` porque un reintento del job debe poder sobrescribir el intento fallido.
   */
  async uploadObject(path: string, body: Buffer, contentType: string): Promise<string | null> {
    if (!this.supabase) return null;
    const { error } = await this.supabase.storage
      .from(this.reportsBucket)
      .upload(path, body, { contentType, upsert: true });
    if (error) {
      this.logger.warn(`uploadObject error: ${error.message}`);
      return null;
    }
    return path;
  }

  async createSignedReportDownloadUrl(path: string, expiresIn = 900): Promise<string | null> {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase.storage
      .from(this.reportsBucket)
      .createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      this.logger.warn(`createSignedReportDownloadUrl error: ${error?.message}`);
      return null;
    }
    return data.signedUrl;
  }
}
