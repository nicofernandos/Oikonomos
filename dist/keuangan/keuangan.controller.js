var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { KeuanganService } from './keuangan.service.js';
import { CreateKeuanganDto } from './dto/create-keuangan.dto.js';
import { UpdateKeuanganDto } from './dto/update-keuangan.dto.js';
let KeuanganController = class KeuanganController {
    keuanganService;
    constructor(keuanganService) {
        this.keuanganService = keuanganService;
    }
    create(createKeuanganDto) {
        return this.keuanganService.create(createKeuanganDto);
    }
    findAll() {
        return this.keuanganService.findAll();
    }
    findOne(id) {
        return this.keuanganService.findOne(+id);
    }
    update(id, updateKeuanganDto) {
        return this.keuanganService.update(+id, updateKeuanganDto);
    }
    remove(id) {
        return this.keuanganService.remove(+id);
    }
};
__decorate([
    Post(),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateKeuanganDto]),
    __metadata("design:returntype", void 0)
], KeuanganController.prototype, "create", null);
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], KeuanganController.prototype, "findAll", null);
__decorate([
    Get(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KeuanganController.prototype, "findOne", null);
__decorate([
    Patch(':id'),
    __param(0, Param('id')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateKeuanganDto]),
    __metadata("design:returntype", void 0)
], KeuanganController.prototype, "update", null);
__decorate([
    Delete(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KeuanganController.prototype, "remove", null);
KeuanganController = __decorate([
    Controller('keuangan'),
    __metadata("design:paramtypes", [KeuanganService])
], KeuanganController);
export { KeuanganController };
//# sourceMappingURL=keuangan.controller.js.map