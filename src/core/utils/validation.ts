import { z, ZodError } from 'zod';

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: ZodError } {
  const result = schema.safeParse(data);
  return result;
}
