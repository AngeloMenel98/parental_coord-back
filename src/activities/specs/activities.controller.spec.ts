import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ActivitiesController } from '../activities.controller';
import { ActivitiesService } from '../activities.service';
import { AssignActivityDto } from '../dto/assign-activity.dto';

const ACTIVITY_ID = 'a1';
const USER_ID = 'u1';
const ASSIGNEE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('ActivitiesController', () => {
  let controller: ActivitiesController;
  let service: {
    assign: jest.Mock;
    reassign: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      assign: jest.fn(),
      reassign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivitiesController],
      providers: [{ provide: ActivitiesService, useValue: service }],
    }).compile();

    controller = module.get<ActivitiesController>(ActivitiesController);
  });

  describe('POST /activities/:id/assign', () => {
    it('calls service.assign with the actor and target assignee', async () => {
      const expected = { id: ACTIVITY_ID, status: 'assigned' };
      service.assign.mockResolvedValue(expected);

      const result = await controller.assignActivity(
        ACTIVITY_ID,
        { id: USER_ID } as any,
        { assignedTo: ASSIGNEE_ID } as any,
      );

      expect(service.assign).toHaveBeenCalledWith(ACTIVITY_ID, USER_ID, ASSIGNEE_ID);
      expect(result).toBe(expected);
    });

    it('works with an empty body (assigns to the actor)', async () => {
      const expected = { id: ACTIVITY_ID, status: 'assigned' };
      service.assign.mockResolvedValue(expected);

      const result = await controller.assignActivity(
        ACTIVITY_ID,
        { id: USER_ID } as any,
        {} as any,
      );

      expect(service.assign).toHaveBeenCalledWith(ACTIVITY_ID, USER_ID, undefined);
      expect(result).toBe(expected);
    });

    it('is decorated as POST :id/assign returning 200', () => {
      const post = Reflect.getMetadata('path', controller.assignActivity);
      expect(post).toBe(':id/assign');
      expect(Reflect.getMetadata('method', controller.assignActivity)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata('__httpCode__', controller.assignActivity)).toBe(HttpStatus.OK);
    });
  });

  describe('AssignActivityDto — global ValidationPipe compatibility', () => {
    // Same config as src/app.module.ts (whitelist + forbidNonWhitelisted + transform).
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    });

    it('accepts an empty body (assigns to the actor)', async () => {
      const dto = await pipe.transform({}, { type: 'body', metatype: AssignActivityDto });
      expect(dto).toBeInstanceOf(AssignActivityDto);
      expect(dto.assignedTo).toBeUndefined();
    });

    it('accepts a valid assignedTo UUID', async () => {
      const dto = await pipe.transform(
        { assignedTo: ASSIGNEE_ID },
        { type: 'body', metatype: AssignActivityDto },
      );
      expect(dto.assignedTo).toBe(ASSIGNEE_ID);
    });

    it('rejects an unknown key (forbidNonWhitelisted)', async () => {
      await expect(
        pipe.transform({ extra: 'x' }, { type: 'body', metatype: AssignActivityDto }),
      ).rejects.toThrow();
    });
  });

  describe('POST /activities/:id/reassign', () => {
    it('calls service.reassign with the actor and target assignee', async () => {
      const expected = { id: ACTIVITY_ID, status: 'assigned' };
      service.reassign.mockResolvedValue(expected);

      const result = await controller.reassignActivity(
        ACTIVITY_ID,
        { id: USER_ID } as any,
        { assignedTo: ASSIGNEE_ID } as any,
      );

      expect(service.reassign).toHaveBeenCalledWith(ACTIVITY_ID, USER_ID, ASSIGNEE_ID);
      expect(result).toBe(expected);
    });

    it('works with an empty body (reassigns to the actor)', async () => {
      const expected = { id: ACTIVITY_ID, status: 'assigned' };
      service.reassign.mockResolvedValue(expected);

      const result = await controller.reassignActivity(
        ACTIVITY_ID,
        { id: USER_ID } as any,
        {} as any,
      );

      expect(service.reassign).toHaveBeenCalledWith(ACTIVITY_ID, USER_ID, undefined);
      expect(result).toBe(expected);
    });

    it('is decorated as POST :id/reassign returning 200', () => {
      expect(Reflect.getMetadata('path', controller.reassignActivity)).toBe(':id/reassign');
      expect(Reflect.getMetadata('method', controller.reassignActivity)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata('__httpCode__', controller.reassignActivity)).toBe(HttpStatus.OK);
    });
  });
});
