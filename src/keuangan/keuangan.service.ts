import { Injectable } from '@nestjs/common';
import { CreateKeuanganDto } from './dto/create-keuangan.dto.js';
import { UpdateKeuanganDto } from './dto/update-keuangan.dto.js';

@Injectable()
export class KeuanganService {
  create(createKeuanganDto: CreateKeuanganDto) {
    return 'This action adds a new keuangan';
  }

  findAll() {
    return `This action returns all keuangan`;
  }

  findOne(id: number) {
    return `This action returns a #${id} keuangan`;
  }

  update(id: number, updateKeuanganDto: UpdateKeuanganDto) {
    return `This action updates a #${id} keuangan`;
  }

  remove(id: number) {
    return `This action removes a #${id} keuangan`;
  }
}
