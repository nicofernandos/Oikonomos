import { CreateKeuanganDto } from './dto/create-keuangan.dto.js';
import { UpdateKeuanganDto } from './dto/update-keuangan.dto.js';
export declare class KeuanganService {
    create(createKeuanganDto: CreateKeuanganDto): string;
    findAll(): string;
    findOne(id: number): string;
    update(id: number, updateKeuanganDto: UpdateKeuanganDto): string;
    remove(id: number): string;
}
