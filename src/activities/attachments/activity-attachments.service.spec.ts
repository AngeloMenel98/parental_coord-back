import { ActivityAttachmentsService } from './activity-attachments.service';
import { ActivityStatus } from '../entities/activity.entity';

/**
 * El contrato de respuesta de este servicio lo consume el cliente Kotlin
 * (`ActivityAttachmentDto`), que exige `activityId` y tipa `uploadedBy` como
 * objeto (`UploadedByDto { id }`). Una respuesta que se aparte de esa forma
 * rompe la deserialización en el dispositivo, no en el servidor, y el fallo es
 * silencioso: la lista queda vacía y el adjunto recién subido nunca se pinta.
 *
 * Estos tests fijan la forma, endpoint por endpoint, para que el desvío se
 * detecte acá.
 */
describe('ActivityAttachmentsService response contract', () => {
  let service: ActivityAttachmentsService;
  let attachmentsRepo: any;
  let activitiesRepo: any;
  let bondsService: any;
  let storage: any;

  const activity = {
    id: 'act-1',
    bondId: 'bond-1',
    status: ActivityStatus.ASSIGNED,
    assignedTo: 'user-1',
  };

  const attachment = {
    id: 'att-1',
    activityId: 'act-1',
    fileUrl: 'activities/bond-1/act-1/file.png',
    fileName: 'prueba.png',
    fileType: 'image/png',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-10-27T12:00:00.000Z'),
  };

  const user = { id: 'user-1', email: 'user@t.com', systemRole: 'user' } as any;

  const expectClientShape = (body: any) => {
    expect(body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        activityId: 'act-1',
        fileName: expect.any(String),
        fileType: expect.any(String),
        uploadedAt: expect.anything(),
        viewUrl: 'https://signed',
      }),
    );
    // `uploadedBy` es un objeto para el cliente, no el uuid suelto.
    expect(body.uploadedBy).toEqual({ id: 'user-1' });
  };

  beforeEach(() => {
    attachmentsRepo = {
      create: jest.fn((v: any) => v),
      // `uploadedAt` lo genera `@CreateDateColumn` en el INSERT y TypeORM lo
      // devuelve en la entidad guardada: el mock lo imita.
      save: jest.fn(async (v: any) => ({
        ...v,
        id: v.id ?? 'att-1',
        uploadedAt: v.uploadedAt ?? attachment.uploadedAt,
      })),
      find: jest.fn().mockResolvedValue([attachment]),
      findOne: jest.fn().mockResolvedValue({ ...attachment }),
      delete: jest.fn(),
    };
    activitiesRepo = { findById: jest.fn().mockResolvedValue(activity) };
    bondsService = { findByUserId: jest.fn().mockResolvedValue([{ id: 'bond-1' }]) };
    storage = {
      objectExists: jest.fn().mockResolvedValue(true),
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
      createSignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ signedUrl: 'https://upload', path: 'activities/bond-1/act-1/file.png' }),
      removeObject: jest.fn().mockResolvedValue(true),
    };

    service = new ActivityAttachmentsService(
      attachmentsRepo,
      activitiesRepo,
      bondsService,
      storage,
    );
  });

  it('list devuelve la forma que el cliente Kotlin puede deserializar', async () => {
    const result = await service.list('act-1', user);

    expect(result).toHaveLength(1);
    expectClientShape(result[0]);
  });

  it('confirm devuelve la forma que el cliente Kotlin puede deserializar', async () => {
    const result = await service.confirm('act-1', user, {
      path: 'activities/bond-1/act-1/file.png',
      fileName: 'prueba.png',
      mimeType: 'image/png',
      sizeBytes: 70,
    });

    expectClientShape(result);
  });

  it('rename devuelve la forma que el cliente Kotlin puede deserializar', async () => {
    const result = await service.rename('act-1', user, 'att-1', 'nuevo.png');

    expectClientShape(result);
  });

  it('replace devuelve la forma que el cliente Kotlin puede deserializar', async () => {
    const result = await service.replace('act-1', user, 'att-1', {
      path: 'activities/bond-1/act-1/file.png',
      fileName: 'prueba.png',
      mimeType: 'image/png',
      sizeBytes: 70,
    });

    expectClientShape(result);
  });
});
