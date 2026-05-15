# Coding Standards

## TypeScript Conventions

### Naming
- **Files**: kebab-case (`order-service.ts`)
- **Classes**: PascalCase (`OrderService`)
- **Functions/variables**: camelCase (`getOrderById`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Interfaces**: PascalCase, no `I` prefix (`OrderRepository`, not `IOrderRepository`)
- **Types**: PascalCase (`OrderStatus`)
- **Enums**: PascalCase with PascalCase members (`OrderStatus.Confirmed`)

### Error Handling
- Use custom error classes extending a base `AppError`
- Always include error codes for API responses
- Never swallow errors silently; log and re-throw or handle

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "RESOURCE_NOT_FOUND", 404);
  }
}
```

### Project Structure
```
src/
├── handlers/        # API route handlers (thin layer)
├── services/        # Business logic
├── repositories/    # Data access layer
├── models/          # Domain models and types
├── middleware/       # Express/Koa middleware
├── utils/           # Shared utilities
└── config/          # Configuration loading
```

### Testing
- Minimum 80% code coverage for services and repositories
- Use `vitest` as the test runner
- Name test files: `*.test.ts` co-located with source
- Use factories for test data, not raw objects
- Mock external dependencies at the repository boundary

### Code Review Checklist
- [ ] No `any` types (use `unknown` if type is truly unknown)
- [ ] Error cases handled with appropriate error classes
- [ ] Input validated at API boundary
- [ ] No secrets or PII in logs
- [ ] Tests cover happy path and at least one error path
- [ ] API changes documented in OpenAPI spec
