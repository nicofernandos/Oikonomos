import { KeuanganService } from './keuangan.service.js';
import { CreateKeuanganDto } from './dto/create-keuangan.dto.js';
import { UpdateKeuanganDto } from './dto/update-keuangan.dto.js';
export declare class KeuanganController {
    private readonly keuanganService;
    constructor(keuanganService: KeuanganService);
    create(createKeuanganDto: CreateKeuanganDto): string;
    findAll(): string;
    findOne(id: string): string;
    update(id: string, updateKeuanganDto: UpdateKeuanganDto): string;
    remove(id: string): string;
}
