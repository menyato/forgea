import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { RequirePermission } from '../authorization/decorators.js';
import { PrintFiles } from './print-files.js';

/**
 * A personalised piece's print files for the slicer: GET /orders/:id/items/:itemId/print/:colour
 * is one colour's STL, GET /orders/:id/items/:itemId/project every colour as one 3MF.
 */
@Controller('orders')
export class PrintFilesController {
  constructor(private readonly files: PrintFiles) {}

  @RequirePermission('orders.view')
  @Get(':id/items/:itemId/project')
  async project(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    const file = await this.files.project(id, itemId);
    return new StreamableFile(file.bytes, {
      type: 'model/3mf',
      disposition: `attachment; filename="${file.name}"`,
      length: file.bytes.byteLength,
    });
  }

  @RequirePermission('orders.view')
  @Get(':id/items/:itemId/print/:colour')
  async stl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('colour') colour: string,
  ): Promise<StreamableFile> {
    const file = await this.files.stl(id, itemId, colour);
    return new StreamableFile(file.bytes, {
      type: 'model/stl',
      disposition: `attachment; filename="${file.name}"`,
      length: file.bytes.byteLength,
    });
  }
}
