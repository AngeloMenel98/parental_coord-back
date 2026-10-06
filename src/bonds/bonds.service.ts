import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { BondsRepository } from './repositories/bonds.repository';
import { BondResponseDto } from './dto/bond-response.dto';

@Injectable()
export class BondsService {
  constructor(private readonly bondRepo: BondsRepository) {}

  async findByUserId(userId: string): Promise<BondResponseDto[]> {
    const bonds = await this.bondRepo.findBondsByUserId(userId);

    const flattened = bonds.map((bond) => ({
      ...bond,
      members: bond.members?.map((m) => ({
        ...m,
        user: m.user
          ? {
              id: m.user.id,
              firstName: m.user.personalData?.firstName ?? '',
              lastName: m.user.personalData?.lastName ?? '',
            }
          : undefined,
      })),
    }));

    return plainToInstance(BondResponseDto, flattened, {
      excludeExtraneousValues: true,
    });
  }
}
