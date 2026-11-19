import { validateSync } from 'class-validator';
import { CreateUserDto } from './create-user.dto.js';
import { UpdateUserDto } from './update-user.dto.js';

describe('user Unicode validation', () => {
  const create = { username: 'newuser', nama: 'Nama', password: '1234567890', peran: 'majelis' };

  describe.each(['\uD800', '\uDC00', 'A\uD800Z', '\uDC00\uD800', '😀\uD800'])('unpaired surrogate %j', (invalid) => {
    it('rejects create name', () => {
      expect(validateSync(Object.assign(new CreateUserDto(), create, { nama: invalid }))).not.toHaveLength(0);
    });
    it('rejects update name', () => {
      expect(validateSync(Object.assign(new UpdateUserDto(), { nama: invalid }))).not.toHaveLength(0);
    });
    it('rejects create password', () => {
      expect(validateSync(Object.assign(new CreateUserDto(), create, { password: `1234567890${invalid}` }))).not.toHaveLength(0);
    });
  });

  it('preserves valid emoji and supplementary characters', () => {
    const nama = 'Nama 😀 🙏 𐀀';
    expect(validateSync(Object.assign(new CreateUserDto(), create, { nama, password: '1234567890😀' }))).toHaveLength(0);
    expect(validateSync(Object.assign(new UpdateUserDto(), { nama }))).toHaveLength(0);
  });
});