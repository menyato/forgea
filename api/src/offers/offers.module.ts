import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { OffersController } from './offers.controller.js';
import { OffersRepository } from './offers.repository.js';
import { OffersService } from './offers.service.js';

/** Free offers (giveaways): set up by the owner, claimed from the shop, checked at checkout. */
@Module({
  imports: [DatabaseModule],
  controllers: [OffersController],
  // The cart prices claimed lines and checkout checks them under a lock.
  exports: [OffersService],
  providers: [OffersService, OffersRepository],
})
export class OffersModule {}
