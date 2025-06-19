export type BTPError = {
  code?: string | number;
  message: string;
};

export type BTPErrorResponse<T = unknown> = {
  data: T;
  errors: BTPError[];
};
