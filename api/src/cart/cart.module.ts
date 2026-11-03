import { Module } from '@nestjs/common';
import { AbandonedCartsCleaner } from './abandoned-carts-cleaner.js';
import { DatabaseModule } from '../database/database.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ProductsModule } from '../products/products.module.js';
import { CartCookie } from './cart-cookie.js';
import { CartController } from './cart.controller.js';
import { CartRepository } from './cart.repository.js';
import { CartService } from './cart.service.js';
import { TextStudioModule } from '../text-studio/text-studio.module.js';

@Module({
  imports: [DatabaseModule, PricingModule, ProductsModule, TextStudioModule],
  controllers: [CartController],
  providers: [CartService, CartRepository, CartCookie, AbandonedCartsCleaner],
  // Checkout (orders module) reads and clears the cart.
  exports: [CartService, CartRepository, CartCookie],
})
export class CartModule {}
