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
      // A line made from an STL or GLB the team uploaded sends that file as it is.
      type: file.name.endsWith('.stl')
        ? 'model/stl'
        : file.name.endsWith('.glb')
          ? 'model/gltf-binary'
          : 'model/3mf',
      disposition: `attachment; filename="${file.name}"`,
      length: file.bytes.byteLength,
    });
  }

  /** The line's model with its text and logos as ordered, as one 3MF project. */
  @RequirePermission('orders.view')
  @Get(':id/items/:itemId/slots-project')
  async slotsProject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    const file = await this.files.slotsProject(id, itemId);
    return new StreamableFile(file.bytes, {
      type: 'model/3mf',
      disposition: `attachment; filename="${file.name}"`,
      length: file.bytes.byteLength,
    });
  }

  /** One of the product's sliced print files, as uploaded, named after the order. */
  @RequirePermission('orders.view')
  @Get(':id/items/:itemId/print-files/:fileId')
  async printFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<StreamableFile> {
    const file = await this.files.productPrintFile(id, itemId, fileId);
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
