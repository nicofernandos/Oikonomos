import { CreateInventarisDto } from './dto/create-inventaris.dto.js';
import { UpdateInventarisDto } from './dto/update-inventaris.dto.js';
export declare class InventarisService {
    create(createInventarisDto: CreateInventarisDto): string;
    findAll(): string;
    findOne(id: number): string;
    update(id: number, updateInventarisDto: UpdateInventarisDto): string;
    remove(id: number): string;
}
