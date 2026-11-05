import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../auth/dto/auth-user.dto';
import { ActivityAttachmentsService } from './activity-attachments.service';
import { PresignAttachmentDto } from './dto/presign-attachment.dto';
import { ConfirmAttachmentDto } from './dto/confirm-attachment.dto';
import { RenameAttachmentDto } from './dto/rename-attachment.dto';
import { ReplaceAttachmentDto } from './dto/replace-attachment.dto';

@Controller('activities/:activityId/attachments')
@UseGuards(JwtAuthGuard)
export class ActivityAttachmentsController {
  constructor(private readonly service: ActivityAttachmentsService) {}

  @Post('presign')
  presign(
    @Param('activityId') activityId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: PresignAttachmentDto,
  ) {
    return this.service.presign(activityId, user, dto);
  }

  @Post('confirm')
  confirm(
    @Param('activityId') activityId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmAttachmentDto,
  ) {
    return this.service.confirm(activityId, user, dto);
  }

  @Get()
  list(@Param('activityId') activityId: string, @CurrentUser() user: AuthUser) {
    return this.service.list(activityId, user);
  }

  @Patch(':attachmentId')
  rename(
    @Param('activityId') activityId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RenameAttachmentDto,
  ) {
    return this.service.rename(activityId, user, attachmentId, dto.fileName);
  }

  @Post(':attachmentId/replace')
  replace(
    @Param('activityId') activityId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceAttachmentDto,
  ) {
    return this.service.replace(activityId, user, attachmentId, dto);
  }

  @Delete(':attachmentId')
  remove(
    @Param('activityId') activityId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.remove(activityId, user, attachmentId);
  }
}
