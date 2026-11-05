import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignActivityDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Target assignee. Omit to assign to the actor.',
  })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}
