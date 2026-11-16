import { PartialType } from '@nestjs/mapped-types';
import { CreateKeuanganDto } from './create-keuangan.dto.js';

export class UpdateKeuanganDto extends PartialType(CreateKeuanganDto) {}
