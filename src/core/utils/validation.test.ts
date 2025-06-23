import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from './validation';

describe('validate', () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it('should return success for valid data', () => {
    const data = { name: 'John Doe', age: 30 };
    const result = validate(testSchema, data);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(data);
    }
  });

  it('should return an error for invalid data', () => {
    const data = { name: 'John Doe', age: 'thirty' }; // age is a string
    const result = validate(testSchema, data);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues[0].path).toEqual(['age']);
    }
  });

  it('should return an error for missing data', () => {
    const data = { name: 'John Doe' }; // age is missing
    const result = validate(testSchema, data);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});
