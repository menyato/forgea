import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PermissionsController } from './permissions.controller.js';
import { TeamAccessService } from './team-access.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/** User records, and the team page with its permissions (admins only). */
@Module({
  imports: [DatabaseModule],
  controllers: [UsersController, PermissionsController],
  providers: [UsersRepository, UsersService, TeamAccessService],
  exports: [UsersRepository],
})
export class UsersModule {}
