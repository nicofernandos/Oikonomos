import { InventarisService } from './inventaris.service.js';
import { CreateInventarisDto } from './dto/create-inventaris.dto.js';
import { UpdateInventarisDto } from './dto/update-inventaris.dto.js';
export declare class InventarisController {
    private readonly inventarisService;
    constructor(inventarisService: InventarisService);
    create(createInventarisDto: CreateInventarisDto): string;
    findAll(): string;
    findOne(id: string): string;
    update(id: string, updateInventarisDto: UpdateInventarisDto): string;
    remove(id: string): string;
}
