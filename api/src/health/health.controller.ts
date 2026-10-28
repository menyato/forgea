import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';
import { Public } from '../authorization/decorators.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  live(): HealthStatus {
    return this.health.live();
  }

  @Get('ready')
  async ready(): Promise<HealthStatus> {
    const result = await this.health.ready();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
