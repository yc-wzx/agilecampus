// 可预期业务错误：message 可直接展示给用户
export class AppError extends Error {}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行此操作") {
    super(message);
  }
}

// C / P0 新增。刻意不动上面三个既有导出——D/E/F 与既有 Action 都依赖它们。
// 这三个只用来让服务层表达「哪一类失败」，由 Action 层翻成契约里的 ErrorCode。

export class NotFoundError extends AppError {
  constructor(message = "资源不存在") {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

/** 并发/版本冲突：乐观锁失败、重复结束、已被他人抢先等。调用方应提示刷新后重试。 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

// postgres 唯一键冲突。drizzle 会把驱动错误包装为 DrizzleQueryError（code 在 cause 上），故两处都查
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? ((e as { cause?: { code?: string } }).cause?.code);
  return code === "23505";
}
