import { Injectable } from '@nestjs/common';
import { CreateInventarisDto } from './dto/create-inventaris.dto.js';
import { UpdateInventarisDto } from './dto/update-inventaris.dto.js';

@Injectable()
export class InventarisService {
  create(createInventarisDto: CreateInventarisDto) {
    return 'This action adds a new inventaris';
  }

  findAll() {
    return `This action returns all inventaris`;
  }

  findOne(id: number) {
    return `This action returns a #${id} inventaris`;
  }

  update(id: number, updateInventarisDto: UpdateInventarisDto) {
    return `This action updates a #${id} inventaris`;
  }

  remove(id: number) {
    return `This action removes a #${id} inventaris`;
  }
}
