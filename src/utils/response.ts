export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
  };
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  meta?: {
    requestId?: string;
  };
}

export function buildSuccess<T>(data: T, requestId?: string): SuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      requestId,
    },
  };
}

export function buildError(code: string, message: string, requestId?: string): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      requestId,
    },
  };
}
