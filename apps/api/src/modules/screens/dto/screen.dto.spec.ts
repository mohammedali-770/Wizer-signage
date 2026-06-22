import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateScreenDto } from './screen.dto';

function errorsFor(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateScreenDto, payload));
}

describe('CreateScreenDto validation', () => {
  it('rejects a volume above 100', () => {
    const errors = errorsFor({ name: 'S', volume: 150 });
    expect(errors.find((e) => e.property === 'volume')).toBeDefined();
  });

  it('rejects a negative volume', () => {
    const errors = errorsFor({ name: 'S', volume: -5 });
    expect(errors.find((e) => e.property === 'volume')).toBeDefined();
  });

  it('accepts a volume in 0-100', () => {
    const errors = errorsFor({ name: 'S', volume: 50 });
    expect(errors.find((e) => e.property === 'volume')).toBeUndefined();
  });

  it('rejects a non-digit kiosk PIN', () => {
    const errors = errorsFor({ name: 'S', kioskPin: 'abcd' });
    expect(errors.find((e) => e.property === 'kioskPin')).toBeDefined();
  });

  it('accepts a 4-8 digit kiosk PIN', () => {
    const errors = errorsFor({ name: 'S', kioskPin: '1234' });
    expect(errors.find((e) => e.property === 'kioskPin')).toBeUndefined();
  });
});
