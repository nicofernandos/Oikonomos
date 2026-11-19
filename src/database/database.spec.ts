import pg from 'pg';
import { DatabaseService } from './database.service.js';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { AppController } from '../app.controller.js';

void DatabaseService;

describe('Keamanan data dasar', () => {
  it('menjaga BIGINT rupiah di luar rentang integer JavaScript secara tepat', () => {
    expect(pg.types.getTypeParser(20)('9007199254740993')).toBe('9007199254740993');
  });

  it('tidak mengekspos endpoint root sebagai publik', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, AppController)).not.toBe(true);
  });
});
