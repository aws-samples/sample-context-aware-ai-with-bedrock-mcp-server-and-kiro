# Security Guidelines

## Authentication & Authorization

### JWT Token Handling
- Tokens MUST be validated on every request using the shared auth middleware
- Token expiry: 15 minutes for access tokens, 7 days for refresh tokens
- Never log full tokens; log only the last 4 characters for debugging
- Store refresh tokens in HttpOnly, Secure, SameSite=Strict cookies

```typescript
// Correct: Use the shared middleware
import { authMiddleware } from "@acme/auth";

app.use("/api", authMiddleware({
  issuer: "https://auth.acme.com",
  audience: "orders-service",
  requiredScopes: ["orders:read"],
}));
```

### API Key Management
- Rotate API keys every 90 days
- Store keys in AWS Secrets Manager, never in environment variables
- Use separate keys for each environment (dev, staging, prod)

## Input Validation
- Validate ALL user input at the API boundary
- Use schema validation (Zod, Joi) for request bodies
- Sanitize strings to prevent XSS and SQL injection
- Limit request body size to 1MB unless explicitly required

```typescript
import { z } from "zod";

const CreateOrderSchema = z.object({
  customerId: z.string().regex(/^cust_[a-z0-9]+$/),
  items: z.array(z.object({
    sku: z.string().min(1).max(50),
    quantity: z.number().int().positive().max(1000),
  })).min(1).max(100),
});
```

## Secrets Management
- Use AWS Secrets Manager for all secrets
- Never commit secrets to version control
- Use IAM roles instead of long-lived credentials
- Enable automatic rotation where supported

## Logging & Monitoring
- Never log PII (emails, names, addresses)
- Mask credit card numbers: show only last 4 digits
- Log security events to a dedicated audit trail
- Set up CloudWatch alarms for: failed auth attempts > 10/min,
  privilege escalation attempts, unusual API access patterns

## Dependency Security
- Run `npm audit` in CI/CD pipeline; fail on high/critical
- Pin major versions in package.json
- Review dependency updates weekly
- Use AWS CodeGuru for automated security reviews
