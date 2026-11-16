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
import { InventarisService } from './inventaris.service.js';
import { CreateInventarisDto } from './dto/create-inventaris.dto.js';
import { UpdateInventarisDto } from './dto/update-inventaris.dto.js';
let InventarisController = class InventarisController {
    inventarisService;
    constructor(inventarisService) {
        this.inventarisService = inventarisService;
    }
    create(createInventarisDto) {
        return this.inventarisService.create(createInventarisDto);
    }
    findAll() {
        return this.inventarisService.findAll();
    }
    findOne(id) {
        return this.inventarisService.findOne(+id);
    }
    update(id, updateInventarisDto) {
        return this.inventarisService.update(+id, updateInventarisDto);
    }
    remove(id) {
        return this.inventarisService.remove(+id);
    }
};
__decorate([
    Post(),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateInventarisDto]),
    __metadata("design:returntype", void 0)
], InventarisController.prototype, "create", null);
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], InventarisController.prototype, "findAll", null);
__decorate([
    Get(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], InventarisController.prototype, "findOne", null);
__decorate([
    Patch(':id'),
    __param(0, Param('id')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateInventarisDto]),
    __metadata("design:returntype", void 0)
], InventarisController.prototype, "update", null);
__decorate([
    Delete(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], InventarisController.prototype, "remove", null);
InventarisController = __decorate([
    Controller('inventaris'),
    __metadata("design:paramtypes", [InventarisService])
], InventarisController);
export { InventarisController };
//# sourceMappingURL=inventaris.controller.js.map