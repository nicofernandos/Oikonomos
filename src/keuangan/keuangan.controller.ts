import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { KeuanganService } from './keuangan.service.js';
import { CreateKeuanganDto } from './dto/create-keuangan.dto.js';
import { UpdateKeuanganDto } from './dto/update-keuangan.dto.js';

@Controller('keuangan')
export class KeuanganController {
  constructor(private readonly keuanganService: KeuanganService) {}

  @Post()
  create(@Body() createKeuanganDto: CreateKeuanganDto) {
    return this.keuanganService.create(createKeuanganDto);
  }

  @Get()
  findAll() {
    return this.keuanganService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.keuanganService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateKeuanganDto: UpdateKeuanganDto) {
    return this.keuanganService.update(+id, updateKeuanganDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.keuanganService.remove(+id);
  }
}
