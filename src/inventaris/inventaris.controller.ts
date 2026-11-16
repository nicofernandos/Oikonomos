import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { InventarisService } from './inventaris.service.js';
import { CreateInventarisDto } from './dto/create-inventaris.dto.js';
import { UpdateInventarisDto } from './dto/update-inventaris.dto.js';

@Controller('inventaris')
export class InventarisController {
  constructor(private readonly inventarisService: InventarisService) {}

  @Post()
  create(@Body() createInventarisDto: CreateInventarisDto) {
    return this.inventarisService.create(createInventarisDto);
  }

  @Get()
  findAll() {
    return this.inventarisService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inventarisService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInventarisDto: UpdateInventarisDto) {
    return this.inventarisService.update(+id, updateInventarisDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.inventarisService.remove(+id);
  }
}
