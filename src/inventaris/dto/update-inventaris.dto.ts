import { PartialType } from '@nestjs/mapped-types';
import { CreateInventarisDto } from './create-inventaris.dto.js';

export class UpdateInventarisDto extends PartialType(CreateInventarisDto) {}
