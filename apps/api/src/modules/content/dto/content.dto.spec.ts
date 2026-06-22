import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateUrlContentDto, UploadContentDto } from './content.dto';

describe('Content DTO validation', () => {
  it('rejects an invalid URL', () => {
    const errors = validateSync(
      plainToInstance(CreateUrlContentDto, { title: 'x', url: 'not-a-url' }),
    );
    expect(errors.find((e) => e.property === 'url')).toBeDefined();
  });

  it('accepts an https URL', () => {
    const errors = validateSync(
      plainToInstance(CreateUrlContentDto, { title: 'x', url: 'https://example.com' }),
    );
    expect(errors.find((e) => e.property === 'url')).toBeUndefined();
  });

  it('requires a title on upload metadata', () => {
    const errors = validateSync(plainToInstance(UploadContentDto, {}));
    expect(errors.find((e) => e.property === 'title')).toBeDefined();
  });
});
